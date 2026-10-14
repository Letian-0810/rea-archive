import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const bundle = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = Buffer.from(resolve(process.argv[2]));
const slash = Buffer.from('/');
const skipped = new Set(['node_modules', '.git', 'dist', '.cache', '.turbo']);
let replaced = 0;
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true, encoding: 'buffer' })) {
    if (skipped.has(entry.name.toString('utf8'))) continue;
    const path = Buffer.concat([directory, slash, entry.name]);
    if (entry.isDirectory()) await visit(path);
    else if (entry.isFile()) {
      const size = (await stat(path)).size;
      if (size < 90 || size > 300) continue;
      const pointer = await readFile(path, 'utf8');
      const match = pointer.match(/^version https:\/\/git-lfs.github.com\/spec\/v1\r?\noid sha256:([a-f0-9]{64})\r?\nsize (\d+)/);
      if (!match) continue;
      const objectPath = join(bundle, 'lfs', 'sha256', match[1]);
      const objectSize = (await stat(objectPath)).size;
      const objectHash = createHash('sha256');
      for await (const chunk of createReadStream(objectPath, { highWaterMark: 65536 })) objectHash.update(chunk);
      if (objectSize !== Number(match[2]) || objectHash.digest('hex') !== match[1]) throw new Error(`LFS object integrity mismatch: ${match[1]}`);
      await copyFile(objectPath, path);
      replaced++;
    }
  }
}
await visit(root);
console.log(JSON.stringify({ materialized_pointer_files: replaced, network_used: false }));
