// Snap-weld: the quality-preserving way to reach an aggressive target on the
// disconnected-island meshes that asset generators produce.
//
// The problem it solves: these meshes are thousands of separate surface patches
// whose seams DON'T share vertices. The topology-preserving simplifier can't
// collapse across those seams, so it floors far above target (a 2M-tri petal
// stops at ~287k). The topology-IGNORING "sloppy" simplifier reaches the target
// but, on a thin sheet (a petal) or thin sticks (incense), fuses the front and
// back surfaces into gravel.
//
// Snap-weld gets the best of both: quantize POSITION onto a grid finer than the
// sheet's thickness but coarser than the seam gaps, so near-coincident seam
// vertices become bitwise-identical -> `weld` reconnects the islands -> the
// topology-preserving `simplify` can now collapse along the connected surface
// WITHOUT fusing front-to-back. The cost is position "terracing" that grows with
// the grid: invisible on something small or in bulk, visible on a big smooth
// surface (so this is wrong for a hero — use standard there).
//
// The grid `q` (as a fraction of model extent) sets how many islands merge and
// therefore the reachable floor. We escalate q until the target is in reach,
// starting fine (least terracing) and coarsening only as needed.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';

const execFileP = promisify(execFile);

// Bounding-box extent + triangle count straight from the glTF JSON chunk —
// POSITION accessors carry min/max per the spec, so no geometry decode needed.
function glbExtentTris(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jsonLen)));
  const accs = json.accessors || [];
  let tris = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const m of json.meshes || []) {
    for (const p of m.primitives || []) {
      if (p.indices != null && accs[p.indices]) tris += Math.floor(accs[p.indices].count / 3);
      const pos = p.attributes && p.attributes.POSITION;
      const a = pos != null ? accs[pos] : null;
      if (a && a.min && a.max) {
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a.min[k]); hi[k] = Math.max(hi[k], a.max[k]); }
      }
    }
  }
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  return { tris, extent: Number.isFinite(extent) && extent > 0 ? extent : 1 };
}

// Quantize every POSITION onto a grid of `step` world units, in place.
async function snapPositions(io, inputPath, outputPath, step) {
  const doc = await io.read(inputPath);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const a = Float32Array.from(pos.getArray());
      for (let i = 0; i < a.length; i++) a[i] = Math.round(a[i] / step) * step;
      pos.setArray(a);
    }
  }
  await io.write(outputPath, doc);
}

// Reduce inputPath -> outputPath (geometry only, uncompressed) to ~targetTris,
// escalating the snap grid until the target is reachable. gt = path to the
// gltf-transform CLI. Returns { q, tris, method }.
export async function snapWeld(gt, inputPath, outputPath, targetTris, opts = {}) {
  const io = new NodeIO();
  const { tris: rawTris, extent } = glbExtentTris(await fs.readFile(inputPath));
  const error = opts.error ?? 0.5;
  // Fine -> coarse. Each step roughly halves the reachable floor. Start point is
  // nudged by how deep a cut we need, to keep the common case to 1–2 passes.
  const qs = opts.qs ?? (targetTris / rawTris < 0.02
    ? [0.012, 0.018, 0.026, 0.035, 0.05]
    : [0.006, 0.009, 0.013, 0.02, 0.03]);
  const snapTmp = outputPath + '.snap.tmp.glb';
  const weldTmp = outputPath + '.weld.tmp.glb';

  let best = null;
  try {
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      await snapPositions(io, inputPath, snapTmp, extent * q);
      await execFileP(gt, ['weld', snapTmp, weldTmp], { maxBuffer: 1 << 28 });
      // Ratio is relative to the WELDED count (what simplify actually operates
      // on), not the raw count — otherwise a well-connected weld overshoots the
      // target and throws away quality we didn't need to.
      const welded = glbExtentTris(await fs.readFile(weldTmp)).tris;
      const ratio = Math.max(0.0005, Math.min(1, targetTris / Math.max(1, welded)));
      await execFileP(gt, ['simplify', weldTmp, outputPath,
        '--ratio', String(ratio), '--error', String(error)], { maxBuffer: 1 << 28 });
      const { tris } = glbExtentTris(await fs.readFile(outputPath));
      best = { q, tris, method: 'snapweld' };
      // Reached the budget (within 25%), or this is the coarsest grid we'll try.
      if (tris <= targetTris * 1.25 || i === qs.length - 1) break;
    }
  } finally {
    await fs.rm(snapTmp, { force: true }).catch(() => {});
    await fs.rm(weldTmp, { force: true }).catch(() => {});
  }
  return best;
}
