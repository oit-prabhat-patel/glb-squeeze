#!/usr/bin/env node
//
// squeeze-cli.js — batch-squeeze a folder of models to a role preset.
//
//   node squeeze-cli.js <input-dir> <output-dir> --preset <hero|prop|decor|particle> [--jobs 4]
//
// Unlike squeeze.sh (which keeps a fixed RATIO of every model), this targets an
// absolute per-role budget, so a folder of mixed-provenance models comes out
// consistent. Originals are never touched; outputs keep their filenames.

import fs from 'node:fs/promises';
import path from 'node:path';
import { squeezeFile } from './lib/squeeze.js';
import { PRESETS, PRESET_NAMES, DEFAULT_PRESET } from './lib/presets.js';

function parseArgs(argv) {
  const pos = [];
  const opt = { preset: DEFAULT_PRESET, jobs: 4 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--preset') opt.preset = argv[++i];
    else if (a === '--jobs') opt.jobs = Math.max(1, parseInt(argv[++i], 10) || 4);
    else if (a.startsWith('--')) { console.error(`unknown flag: ${a}`); process.exit(1); }
    else pos.push(a);
  }
  return { inDir: pos[0], outDir: pos[1], ...opt };
}

const mb = (b) => (b / 1048576).toFixed(2);
const n = (x) => Math.round(x).toLocaleString();

async function main() {
  const { inDir, outDir, preset, jobs } = parseArgs(process.argv.slice(2));
  if (!inDir || !outDir) {
    console.error('usage: squeeze-cli.js <input-dir> <output-dir> --preset ' +
      `<${PRESET_NAMES.join('|')}> [--jobs 4]`);
    process.exit(1);
  }
  if (!PRESETS[preset]) {
    console.error(`unknown preset "${preset}". Options: ${PRESET_NAMES.join(', ')}`);
    process.exit(1);
  }

  const entries = (await fs.readdir(inDir))
    .filter((f) => /\.(glb|gltf)$/i.test(f))
    .sort();
  if (!entries.length) { console.error(`no .glb/.gltf files in ${inDir}`); process.exit(1); }

  const p = PRESETS[preset];
  console.log(`squeeze: ${entries.length} model(s) → ${outDir}`);
  console.log(`  preset=${preset}  target=${n(p.targetTris)} tris  textures=${p.texSize}px  jobs=${jobs}\n`);

  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < entries.length) {
      const name = entries[idx++];
      const src = path.join(inDir, name);
      const dst = path.join(outDir, name);
      try {
        const r = await squeezeFile(src, dst, preset);
        results.push({ name, ok: true, ...r });
        const shrink = r.before.bytes / Math.max(1, r.after.bytes);
        console.log(`  ✓ ${name.padEnd(46)} ${n(r.before.tris)} → ${n(r.after.tris)} tris` +
          `  ${mb(r.before.bytes)} → ${mb(r.after.bytes)} MB  (${shrink.toFixed(1)}x)`);
      } catch (e) {
        results.push({ name, ok: false, error: String(e.message || e) });
        console.log(`  ✗ ${name.padEnd(46)} FAILED — ${String(e.message || e).split('\n')[0]}`);
      }
    }
  }
  await Promise.all(Array.from({ length: jobs }, worker));

  const ok = results.filter((r) => r.ok);
  const fail = results.length - ok.length;
  const b = ok.reduce((s, r) => s + r.before.bytes, 0);
  const a = ok.reduce((s, r) => s + r.after.bytes, 0);
  const bt = ok.reduce((s, r) => s + r.before.tris, 0);
  const at = ok.reduce((s, r) => s + r.after.tris, 0);
  console.log('\n' + '─'.repeat(48));
  console.log(`  ${ok.length} ok${fail ? `, ${fail} FAILED` : ''}`);
  if (ok.length) {
    console.log(`  ${n(bt)} → ${n(at)} tris   ${mb(b)} → ${mb(a)} MB` +
      `  (${(b / Math.max(1, a)).toFixed(1)}x smaller, ${((1 - a / b) * 100).toFixed(1)}% saved)`);
  }
  console.log('─'.repeat(48));
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
