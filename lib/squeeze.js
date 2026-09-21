// Squeeze one model to a preset budget, with CONSISTENT output across inputs.
//
// It shells to the same `gltf-transform optimize` pipeline squeeze.sh uses (a
// proven Draco + WebP path), but first reads the input's triangle count and
// derives the per-file simplify ratio needed to hit the preset's absolute
// target. That derivation is the whole trick: it's why a 2M-tri hero and a
// 300k-tri prop both come out near their role's budget instead of at some fixed
// fraction of whatever they happened to start as.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS, resolvePreset } from './presets.js';

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

// Squeeze inputPath → outputPath for `presetName`. Returns before/after stats
// plus the ratio and whether geometry was actually simplified.
export async function squeezeFile(inputPath, outputPath, presetName) {
  const name = resolvePreset(presetName);
  const preset = PRESETS[name];

  const inBuf = await fs.readFile(inputPath);
  const before = glbStats(inBuf) || { tris: 0, verts: 0, images: 0, bytes: inBuf.byteLength };

  // Only simplify when the input is meaningfully over budget — a model already
  // under target keeps all its geometry and just gets compressed + resized.
  const overBudget = before.tris > preset.targetTris * 1.05;
  let ratio = 1;
  if (overBudget) {
    ratio = preset.targetTris / before.tris;
    ratio = Math.max(0.0005, Math.min(1, ratio)); // clamp to sane bounds
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const args = [
    'optimize', inputPath, outputPath,
    '--compress', 'draco',
    '--texture-compress', 'webp',
    '--texture-size', String(preset.texSize),
  ];
  if (overBudget) {
    args.push('--simplify', 'true',
      '--simplify-ratio', String(ratio),
      '--simplify-error', String(preset.error));
  } else {
    args.push('--simplify', 'false');
  }

  await execFileP(GT, args, { maxBuffer: 1 << 28 });

  const outBuf = await fs.readFile(outputPath);
  const after = glbStats(outBuf) || { tris: 0, verts: 0, images: 0, bytes: outBuf.byteLength };

  return { preset: name, ratio, simplified: overBudget, before, after };
}
