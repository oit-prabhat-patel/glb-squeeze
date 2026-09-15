#!/usr/bin/env node
//
// sway.js — render a GLB gently swaying left/right into a looping animated WebP.
//
//   node render/sway.js <model.glb> <out.webp> [--key value ...]
//
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import puppeteer from 'puppeteer';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const [, , modelArg, outArg, ...rest] = process.argv;
if (!modelArg || !outArg) {
  console.error('usage: sway.js <model.glb> <out.webp> [--frames 48] [--fps 20] ' +
                '[--amp 14] [--yaw 0] [--anchorX 0.72] [--fill 0.86] [--w 900] [--h 540] [--q 82]');
  process.exit(1);
}

const DEFAULTS = {frames: 30, fps: 15, amp: 14, yaw: 0, anchorX: 0.72, anchorY: 0.46,
                  fill: 0.78, fillW: 0.52, w: 720, h: 432, q: 72,
                  glowR: 0.78, glowA: 0.73, keepFrames: 0};
const opt = {...DEFAULTS};

// Validate rather than silently ignore. A shell that doesn't word-split (zsh
// expanding an unquoted "$FLAGS") delivers every flag as one argv element;
// accepting that quietly renders defaults while reporting success, which makes
// two runs look different when they are byte-identical.
const die = (m) => { console.error(`sway: ${m}`); process.exit(1); };
if (rest.length % 2) die(`each flag needs a value (got ${rest.length} extra args)`);
for (let i = 0; i < rest.length; i += 2) {
  const flag = rest[i];
  if (!flag.startsWith('--')) {
    die(`expected a --flag, got "${flag}"` +
        (flag.includes(' ') ? ' — looks like an unsplit shell variable' : ''));
  }
  const key = flag.slice(2);
  if (!(key in DEFAULTS)) die(`unknown flag --${key}`);
  const raw = rest[i + 1];
  const num = Number(raw);
  if (!Number.isFinite(num)) die(`--${key} needs a number, got "${raw}"`);
  opt[key] = num;
}

const modelPath = path.resolve(modelArg);
const outPath   = path.resolve(outArg);
if (!fs.existsSync(modelPath)) { console.error(`no such model: ${modelPath}`); process.exit(1); }

// Serve scene.html and the model over http — three.js fetches the GLB, which
// file:// blocks as a cross-origin read.
const MIME = {'.html':'text/html', '.glb':'model/gltf-binary', '.js':'text/javascript'};
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = url === '/model.glb' ? modelPath : path.join(HERE, path.basename(url));
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream'});
    res.end(buf);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sway-'));
const browser = await puppeteer.launch({
  args: ['--enable-gpu', '--use-gl=angle', '--hide-scrollbars'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({width: opt.w, height: opt.h, deviceScaleFactor: 1});

  const qs = new URLSearchParams({
    model: '/model.glb', w: opt.w, h: opt.h,
    amp: opt.amp, yaw: opt.yaw, anchorX: opt.anchorX, anchorY: opt.anchorY,
    fill: opt.fill, fillW: opt.fillW, glowR: opt.glowR, glowA: opt.glowA,
  });
  await page.goto(`${base}/scene.html?${qs}`, {waitUntil: 'networkidle0', timeout: 60000});
  await page.waitForFunction('window.__ready === true || window.__error', {timeout: 90000});

  const err = await page.evaluate('window.__error');
  if (err) throw new Error(`scene failed to load model: ${err}`);

  process.stdout.write(`rendering ${opt.frames} frames @ ${opt.w}x${opt.h} `);
  const files = [];
  for (let i = 0; i < opt.frames; i++) {
    const data = await page.evaluate((phase) => {
      window.__frame(phase);
      return document.querySelector('canvas').toDataURL('image/png');
    }, i / opt.frames);
    const f = path.join(tmp, `f${String(i).padStart(4, '0')}.png`);
    fs.writeFileSync(f, Buffer.from(data.split(',')[1], 'base64'));
    files.push(f);
    if (i % 8 === 0) process.stdout.write('.');
  }
  console.log(' done');

  fs.mkdirSync(path.dirname(outPath), {recursive: true});
  // img2webp defaults to lossless, which costs ~20x here for no visible gain
  // on a rendered gradient backdrop. -min_size buys a further ~2% at the same
  // quality. File-level flags must precede the per-frame ones.
  //
  // Measured and rejected: -kmin 0 -kmax 0. Disabling keyframes changed
  // nothing (957 KB either way) because the encoder was not inserting extra
  // keyframes here to begin with. Size is dominated by how many pixels
  // actually move, so the only real levers are --q, --w/--h and --frames.
  execFileSync('img2webp', [
    '-loop', '0', '-min_size',
    '-d', String(Math.round(1000 / opt.fps)),
    '-lossy', '-q', String(opt.q), '-m', '6',
    ...files, '-o', outPath,
  ], {stdio: ['ignore', 'ignore', 'inherit']});

  // Still of the NEUTRAL frame (phase 0, zero sway) — the pose to judge facing
  // and framing against. A mid-sway frame reads as "turned" and misleads.
  fs.copyFileSync(files[0], outPath.replace(/\.webp$/, '-still.png'));

  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`${outPath}  ${kb} KB  ${opt.frames}f @ ${opt.fps}fps ` +
              `(${(opt.frames / opt.fps).toFixed(1)}s loop)`);
  if (opt.keepFrames) {
    const keep = outPath.replace(/\.webp$/, '-frames');
    fs.rmSync(keep, {recursive: true, force: true});
    fs.cpSync(tmp, keep, {recursive: true});
    console.log(`frames kept: ${keep}`);
  }
} finally {
  await browser.close();
  server.close();
  fs.rmSync(tmp, {recursive: true, force: true});
}
