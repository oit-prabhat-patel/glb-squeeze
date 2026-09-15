#!/usr/bin/env node
//
// contact.js — render each model at a range of facings, as one strip per
// model, so you can pick the front-on yaw by eye before batch rendering.
//
//   node render/contact.js <out-dir> <model.glb> [more.glb ...]
//
// Each model is loaded once and swept, rather than relaunching per angle.
//
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import puppeteer from 'puppeteer';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YAWS = [0, 45, 90, 135, 180, 225, 270, 315];
const CELL = 260;

const [, , outDir, ...models] = process.argv;
if (!outDir || !models.length) {
  console.error('usage: contact.js <out-dir> <model.glb> [more.glb ...]');
  process.exit(1);
}

let current = null;   // path of the model the server should serve
const MIME = {'.html': 'text/html', '.glb': 'model/gltf-binary'};
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = url === '/model.glb' ? current : path.join(HERE, path.basename(url));
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream'});
    res.end(buf);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

fs.mkdirSync(outDir, {recursive: true});
const browser = await puppeteer.launch({args: ['--enable-gpu', '--use-gl=angle']});
const index = [];

try {
  const page = await browser.newPage();
  await page.setViewport({width: CELL, height: CELL, deviceScaleFactor: 1});

  for (const m of models) {
    current = path.resolve(m);
    const name = path.basename(m, path.extname(m));
    if (!fs.existsSync(current)) { console.error(`skip (missing): ${m}`); continue; }

    const qs = new URLSearchParams({
      model: '/model.glb', w: CELL, h: CELL,
      anchorX: 0.5, anchorY: 0.5, fill: 0.85, fillW: 0.9, amp: 0,
    });
    // cache-bust so /model.glb is refetched now that `current` has moved on
    await page.goto(`${base}/scene.html?${qs}&m=${encodeURIComponent(name)}`,
                    {waitUntil: 'networkidle0', timeout: 60000});
    await page.waitForFunction('window.__ready === true || window.__error', {timeout: 120000});
    if (await page.evaluate('window.__error')) {
      console.error(`skip (load failed): ${name}`); continue;
    }

    const strip = [];
    for (const y of YAWS) {
      const data = await page.evaluate((yaw) => {
        window.__setYaw(yaw);
        window.__frame(0);
        return document.querySelector('canvas').toDataURL('image/png');
      }, y);
      const f = path.join(outDir, `${name}__y${y}.png`);
      fs.writeFileSync(f, Buffer.from(data.split(',')[1], 'base64'));
      strip.push(f);
    }
    index.push({name, strip});
    console.log(`${name}: ${YAWS.length} facings`);
  }
} finally {
  await browser.close();
  server.close();
}

fs.writeFileSync(path.join(outDir, 'index.json'),
                 JSON.stringify({yaws: YAWS, models: index}, null, 2));
console.log(`\n${index.length} model(s) → ${outDir}`);
console.log(`facings: ${YAWS.join('  ')}`);
