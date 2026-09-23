// Squeeze one model to a preset budget + quality preference, with CONSISTENT
// output across inputs.
//
// It shells to the same `gltf-transform optimize` pipeline squeeze.sh uses (a
// proven Draco + WebP path) for the final compression, but first reduces geometry
// with the METHOD the role calls for (standard / sloppy / snapweld — see
// presets.js), derived from the input's own triangle count so a 2M-tri hero and a
// 300k-tri prop both land near their role's budget instead of at some fixed
// fraction of whatever they started as.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { effectivePreset } from './presets.js';
import { sloppySimplify } from './sloppy.js';
import { snapWeld } from './snapweld.js';

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GT = path.join(HERE, '..', 'node_modules', '.bin', 'gltf-transform');

// Triangle / vertex / texture stats straight from the glTF JSON chunk. The
// accessor counts survive Draco compression (the KHR extension keeps them), so
// this reads compressed output too — no decoder needed. Returns null if the
// buffer isn't a GLB (e.g. a .gltf) so callers can degrade to size-only stats.
export function glbStats(buf) {
  try {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint32(0, true) !== 0x46546c67) return null; // 'glTF' magic
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jsonLen)));
    const accs = json.accessors || [];
    let tris = 0, verts = 0;
    for (const m of json.meshes || []) {
      for (const p of m.primitives || []) {
        if (p.indices != null && accs[p.indices]) tris += Math.floor(accs[p.indices].count / 3);
        const pos = p.attributes && p.attributes.POSITION;
        if (pos != null && accs[pos]) verts += accs[pos].count;
      }
    }
    return { tris, verts, images: (json.images || []).length, bytes: u8.byteLength };
  } catch {
    return null;
  }
}

// Squeeze inputPath → outputPath for `presetName` at `quality`. Returns
// before/after stats plus the resolved preset, method and (for snapweld) grid.
export async function squeezeFile(inputPath, outputPath, presetName, quality) {
  const pre = effectivePreset(presetName, quality);

  const inBuf = await fs.readFile(inputPath);
  const before = glbStats(inBuf) || { tris: 0, verts: 0, images: 0, bytes: inBuf.byteLength };

  // Only reduce geometry when the input is meaningfully over budget — a model
  // already under target keeps all its geometry and just gets compressed/resized.
  const overBudget = before.tris > pre.targetTris * 1.05;
  const method = overBudget ? pre.method : 'compress-only';

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Geometry reduction happens BEFORE the compress pass. 'sloppy' and 'snapweld'
  // write an uncompressed intermediate and then optimize just compresses; only
  // 'standard' lets optimize do the simplify (topology-preserving) itself.
  let geomPath = inputPath;
  let tmp = null, snap = null;
  const ratio = overBudget ? Math.max(0.0005, Math.min(1, pre.targetTris / before.tris)) : 1;

  try {
    if (overBudget && method === 'sloppy') {
      tmp = outputPath + '.sloppy.tmp.glb';
      await sloppySimplify(inputPath, tmp, ratio);
      geomPath = tmp;
    } else if (overBudget && method === 'snapweld') {
      tmp = outputPath + '.snapweld.tmp.glb';
      snap = await snapWeld(GT, inputPath, tmp, pre.targetTris, { error: pre.error });
      geomPath = tmp;
    }

    const args = [
      'optimize', geomPath, outputPath,
      '--compress', 'draco',
      '--texture-compress', 'webp',
      '--texture-size', String(pre.texSize),
    ];
    if (overBudget && method === 'standard') {
      args.push('--simplify', 'true',
        '--simplify-ratio', String(ratio),
        '--simplify-error', String(pre.error));
    } else {
      args.push('--simplify', 'false'); // already reduced (sloppy/snapweld), or under budget
    }

    await execFileP(GT, args, { maxBuffer: 1 << 28 });
  } finally {
    if (tmp) await fs.rm(tmp, { force: true }).catch(() => {});
  }

  const outBuf = await fs.readFile(outputPath);
  const after = glbStats(outBuf) || { tris: 0, verts: 0, images: 0, bytes: outBuf.byteLength };

  return {
    preset: pre.name, quality: pre.quality, method,
    targetTris: pre.targetTris, texSize: pre.texSize,
    snapQ: snap ? snap.q : undefined,
    simplified: overBudget, before, after,
  };
}
