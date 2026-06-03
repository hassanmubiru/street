#!/usr/bin/env node
/**
 * SQLite WASM binary download script.
 *
 * Downloads the official pre-built SQLite WASM binary from the sqlite.org
 * CDN and places it at packages/core/src/database/sqlite/sqlite3.wasm.
 *
 * Usage (run once before building):
 *   node packages/core/src/database/sqlite/download-wasm.mjs
 *
 * The downloaded binary is the official Emscripten-compiled build from:
 *   https://sqlite.org/wasm/doc/trunk/index.md
 *
 * Source: https://sqlite.org/2024/sqlite-wasm-3470200.zip
 * SHA-256 is printed during download for verification.
 */
import { createWriteStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { get } from 'node:https';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(__dirname, 'sqlite3.wasm');

// Official SQLite WASM build - sqlite3.wasm from the @sqlite.org/sqlite-wasm npm package
// https://www.npmjs.com/package/@sqlite.org/sqlite-wasm
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@3.47.2-build1/sqlite-wasm/jswasm/sqlite3.wasm';

if (existsSync(WASM_PATH)) {
  console.log('sqlite3.wasm already exists at:', WASM_PATH);
  console.log('Delete the file and re-run to re-download.');
  process.exit(0);
}

console.log('Downloading SQLite WASM binary...');
console.log('URL:', WASM_URL);
console.log('Destination:', WASM_PATH);

const hash = createHash('sha256');
const fileStream = createWriteStream(WASM_PATH);
const hashCapture = new Writable({
  write(chunk, _enc, cb) {
    hash.update(chunk);
    cb();
  },
});

function fetchUrl(url, redirectCount = 0) {
  if (redirectCount > 5) throw new Error('Too many redirects');
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(fetchUrl(res.headers.location, redirectCount + 1));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

try {
  const res = await fetchUrl(WASM_URL);
  await Promise.all([
    pipeline(res, fileStream),
  ]);
  // Re-read file to compute hash
  const { createReadStream } = await import('node:fs');
  const readHash = createHash('sha256');
  await pipeline(createReadStream(WASM_PATH), new Writable({
    write(chunk, _enc, cb) { readHash.update(chunk); cb(); },
  }));
  console.log('SHA-256:', readHash.digest('hex'));
  console.log('Download complete:', WASM_PATH);
} catch (err) {
  // Clean up partial file
  try {
    const { unlinkSync } = await import('node:fs');
    if (existsSync(WASM_PATH)) unlinkSync(WASM_PATH);
  } catch { /* ignore */ }
  console.error('Download failed:', err.message);
  process.exit(1);
}
