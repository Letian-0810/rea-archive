import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function hash(path, algorithm = 'sha256') {
  const h = createHash(algorithm);
  for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) h.update(chunk);
  return h.digest('hex');
}
async function matches(path, bytes, sha) {
  try { return (await stat(path)).size === bytes && await hash(path) === sha; }
  catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
async function download(url, path, bytes, sha, headers = {}) {
  if (await matches(path, bytes, sha)) return;
  await mkdir(dirname(path), { recursive: true });
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(180000) });
      if (!response.ok || !response.body) throw new Error(`Download HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
      if (!await matches(path, bytes, sha)) throw new Error(`Content identity mismatch: ${path}`);
      return;
    } catch (e) { last = e; }
  }
  throw last;
}
for (const name of ['upstream-tree', 'lfs-pointers']) {
  await writeFile(join(root, 'provenance', name + '.json'), gunzipSync(await readFile(join(root, 'provenance', name + '.json.gz'))));
}
const manifest = JSON.parse(await readFile(join(root, 'provenance/archives.json'), 'utf8'));
const sources = JSON.parse(await readFile(join(root, 'provenance/archive-downloads.json'), 'utf8'));
for (const entry of manifest.artifacts) {
  const path = join(root, entry.file);
  if (await matches(path, entry.bytes, entry.sha256)) continue;
  const url = sources[entry.file];
  if (!url) throw new Error(`Required preserved artifact missing: ${entry.file}`);
  await download(url, path, entry.bytes, entry.sha256);
  console.log(`Verified archive: ${entry.file}`);
}
const pointers = JSON.parse(await readFile(join(root, 'provenance/lfs-pointers.json'), 'utf8')).pointers;
const objects = [...new Map(pointers.map(p => [p.oid, { oid: p.oid, size: p.bytes }])).values()];
let completed = 0;
for (let start = 0; start < objects.length; start += 75) {
  const pending = [];
  for (const item of objects.slice(start, start + 75)) {
    if (!await matches(join(root, 'lfs/sha256', item.oid), item.size, item.oid)) pending.push(item);
    else completed++;
  }
  if (!pending.length) continue;
  const response = await fetch('https://github.com/onekey-sec/unblob.git/info/lfs/objects/batch', {
    method: 'POST', headers: { 'content-type': 'application/vnd.git-lfs+json', accept: 'application/vnd.git-lfs+json' },
    body: JSON.stringify({ operation: 'download', transfers: ['basic'], objects: pending }), signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`LFS batch HTTP ${response.status}`);
  const batch = await response.json();
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < batch.objects.length) {
      const item = batch.objects[next++];
      if (item.error || !item.actions?.download) throw new Error(`LFS unavailable: ${item.oid}`);
      await download(item.actions.download.href, join(root, 'lfs/sha256', item.oid), item.size, item.oid, item.actions.download.header || {});
      completed++;
    }
  }));
  console.log(`LFS verified: ${completed}/${objects.length}`);
}
await writeFile(join(root, 'provenance/lfs-integrity.json'), JSON.stringify({ pointers: pointers.length, unique_objects: objects.length, verified_objects: completed, verified_bytes: objects.reduce((sum, o) => sum + o.size, 0), missing: [] }, null, 2) + '\n');
if (completed !== objects.length) throw new Error('LFS batch omitted required objects');
console.log('All original artifacts and LFS objects preserved.');
