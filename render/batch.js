#!/usr/bin/env node
//
// batch.js — render every model in a config to a looping sway animation.
//
//   node render/batch.js <config.json> <out-dir> [--frames 2]   # fast preview
//   node render/batch.js <config.json> <out-dir>                # full render
//
// Config shape:
//   { "modelDir": "...", "defaults": {...}, "models": [ {"file": "x.glb",
//     "name": "x", "yaw": -20, ...overrides} ] }
//
// Per-model overrides exist because these subjects are not interchangeable:
// a standing figure, a chariot-and-horses and a shrine need different fits.
//
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {spawnSync} from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [, , cfgPath, outDir, ...rest] = process.argv;
if (!cfgPath || !outDir) {
  console.error('usage: batch.js <config.json> <out-dir> [--frames N]');
  process.exit(1);
}

const cli = {};
for (let i = 0; i < rest.length; i += 2) cli[rest[i].replace(/^--/, '')] = rest[i + 1];

// Consumed here, not forwarded — sway.js rejects flags it doesn't know.
const modelDirArg = cli.modelDir; delete cli.modelDir;

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const untilde = (p) => p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
const rawDir = untilde(modelDirArg ?? cfg.modelDir ?? '.');
const modelDir = path.isAbsolute(rawDir)
  ? rawDir
  : path.resolve(path.dirname(cfgPath), rawDir);

if (!fs.existsSync(modelDir)) {
  console.error(`batch: model dir not found: ${modelDir}\n` +
                `       set "modelDir" in the config or pass --modelDir <path>`);
  process.exit(1);
}
fs.mkdirSync(outDir, {recursive: true});

let ok = 0, failed = 0, bytes = 0;
const t0 = process.hrtime.bigint();

for (const m of cfg.models) {
  const params = {...cfg.defaults, ...m, ...cli};
  delete params.file; delete params.name;

  const src = path.join(modelDir, m.file);
  const dst = path.join(outDir, `${m.name}.webp`);
  const args = [path.join(HERE, 'sway.js'), src, dst];
  for (const [k, v] of Object.entries(params)) args.push(`--${k}`, String(v));

  const r = spawnSync(process.execPath, args, {encoding: 'utf8'});
  if (r.status !== 0) {
    failed++;
    console.log(`  ✗ ${m.name}  ${(r.stderr || '').trim().split('\n').pop()}`);
    continue;
  }
  const kb = fs.statSync(dst).size / 1024;
  bytes += fs.statSync(dst).size;
  ok++;
  console.log(`  ✓ ${m.name.padEnd(24)} ${kb.toFixed(0).padStart(5)} KB`);
}

const secs = Number(process.hrtime.bigint() - t0) / 1e9;
console.log('─'.repeat(45));
console.log(`  ${ok} rendered${failed ? `, ${failed} FAILED` : ''} in ${secs.toFixed(0)}s`);
if (ok) console.log(`  ${(bytes / 1048576).toFixed(1)} MB total, ` +
                    `${(bytes / ok / 1024).toFixed(0)} KB average`);
