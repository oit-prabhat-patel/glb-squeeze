#!/usr/bin/env node
//
// server.js — local drag-and-drop squeeze + before/after preview.
//
//   npm run ui          # then open http://localhost:4747
//
// A tiny localhost server (no framework). The browser drops a .glb, this squeezes
// it with the chosen preset via lib/squeeze.js, and hands back the optimized file
// plus stats; the page previews original vs squeezed side by side. Binds to
// 127.0.0.1 only — it runs the CLI on whatever you POST, so never expose it.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { squeezeFile, glbStats } from './lib/squeeze.js';
import { PRESETS, PRESET_NAMES } from './lib/presets.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, 'web');
const PORT = parseInt(process.env.PORT, 10) || 4747;
const MAX_UPLOAD = 400 * 1024 * 1024; // 400 MB — generator models get large

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('upload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(WEB, path.normalize(rel));
  if (!file.startsWith(WEB)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const buf = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('not found');
  }
}

async function handleSqueeze(req, res, url) {
  const preset = url.searchParams.get('preset') || 'prop';
  const name = (url.searchParams.get('name') || 'model.glb').replace(/[^\w.\-]/g, '_');
  if (!PRESETS[preset]) { res.writeHead(400).end('unknown preset'); return; }

  let body;
  try { body = await readBody(req, MAX_UPLOAD); }
  catch (e) { res.writeHead(413).end(String(e.message || e)); return; }

  const tmp = path.join(os.tmpdir(), 'glbsq-' + crypto.randomUUID());
  const inFile = tmp + '-in.glb', outFile = tmp + '-out.glb';
  try {
    await fs.writeFile(inFile, body);
    const r = await squeezeFile(inFile, outFile, preset);
    const outBuf = await fs.readFile(outFile);
    res.writeHead(200, {
      'content-type': 'model/gltf-binary',
      'content-disposition': `attachment; filename="${name}"`,
      'x-stats': Buffer.from(JSON.stringify(r)).toString('base64'),
      'cache-control': 'no-store',
    });
    res.end(outBuf);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('squeeze failed: ' + String(e.message || e).split('\n')[0]);
  } finally {
    fs.rm(inFile, { force: true }).catch(() => {});
    fs.rm(outFile, { force: true }).catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'POST' && url.pathname === '/squeeze') return handleSqueeze(req, res, url);
  if (req.method === 'GET' && url.pathname === '/presets') {
    const out = {};
    for (const k of PRESET_NAMES) out[k] = PRESETS[k];
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(out));
  }
  if (req.method === 'GET') return serveStatic(res, url.pathname);
  res.writeHead(405).end('method not allowed');
});

// Open the default browser (used by the double-click launcher; GLBSQ_OPEN=1).
function openBrowser(url) {
  try {
    if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  } catch { /* headless / no browser — the printed URL still works */ }
}

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  glb-squeeze UI  →  ${url}\n`);
  console.log(`  presets: ${PRESET_NAMES.join(', ')}`);
  console.log('  drop .glb models in the browser to squeeze + preview.\n');
  if (process.env.GLBSQ_OPEN === '1') openBrowser(url);
});
