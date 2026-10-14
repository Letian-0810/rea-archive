import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function digest(path, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) hash.update(chunk);
  return hash.digest('hex');
}
const manifest = JSON.parse(await readFile(join(root, 'provenance/archives.json'), 'utf8'));
let archiveBytes = 0;
for (const entry of manifest.artifacts) {
  const path = resolve(root, entry.file);
  if (!path.startsWith(root + sep)) throw new Error('Archive path outside bundle');
  if ((await stat(path)).size !== entry.bytes || await digest(path, 'sha256') !== entry.sha256) throw new Error('Archive mismatch: ' + entry.file);
  archiveBytes += entry.bytes;
}
const pointers = JSON.parse(await readFile(join(root, 'provenance/lfs-pointers.json'), 'utf8')).pointers;
const objects = new Map(pointers.map(entry => [entry.oid, entry.bytes]));
let lfsBytes = 0;
for (const [oid, bytes] of objects) {
  if (!/^[a-f0-9]{64}$/.test(oid)) throw new Error('Invalid LFS object identity');
  const path = join(root, 'lfs/sha256', oid);
  if ((await stat(path)).size !== bytes || await digest(path, 'sha256') !== oid) throw new Error('LFS mismatch: ' + oid);
  lfsBytes += bytes;
}
const cacheRoot = join(root, 'npm-cache/_cacache/content-v2/sha512');
let npmObjects = 0;
let npmBytes = 0;
async function verifyCache(directory, identity = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await verifyCache(path, identity + entry.name);
    else if (entry.isFile()) {
      const expected = identity + entry.name;
      if (!/^[a-f0-9]{128}$/.test(expected) || await digest(path, 'sha512') !== expected) throw new Error('npm content cache mismatch: ' + path);
      npmObjects++;
      npmBytes += (await stat(path)).size;
    } else throw new Error('Unexpected npm cache entry: ' + path);
  }
}
await verifyCache(cacheRoot);
const result = { checked_at: new Date().toISOString(), passed: true, archive_files: manifest.artifacts.length, archive_bytes: archiveBytes, lfs_pointer_paths: pointers.length, lfs_unique_objects: objects.size, lfs_bytes: lfsBytes, npm_content_objects: npmObjects, npm_content_bytes: npmBytes, hash_read_chunk_bytes: 65536, network_used: false };
await writeFile(join(root, 'verification/local-integrity.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
