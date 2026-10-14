import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const bundle = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.argv[2]);
const applied = [];
for (const name of (await readdir(join(bundle, 'patches'))).filter(name => name.endsWith('.json')).sort()) {
  const patch = JSON.parse(await readFile(join(bundle, 'patches', name), 'utf8'));
  const target = resolve(source, patch.path);
  if (!target.startsWith(source + sep)) throw new Error('Patch path escapes source directory.');
  const original = await readFile(target);
  const digest = createHash('sha256').update(original).digest('hex');
  if (digest === patch.after_sha256) { applied.push({ id: patch.id, already_applied: true }); continue; }
  if (digest !== patch.before_sha256) throw new Error(`Patch input differs from pinned source: ${patch.path}`);
  const text = original.toString('utf8');
  if (text.split(patch.find).length !== 2) throw new Error('Patch target must occur exactly once.');
  const changed = Buffer.from(text.replace(patch.find, patch.replace));
  if (createHash('sha256').update(changed).digest('hex') !== patch.after_sha256) throw new Error('Patch output integrity mismatch.');
  await writeFile(target, changed);
  applied.push({ id: patch.id, before_sha256: patch.before_sha256, after_sha256: patch.after_sha256 });
}
await mkdir(join(source, '..', 'verification'), { recursive: true });
await writeFile(join(source, '..', 'verification', 'applied-patches.json'), JSON.stringify(applied, null, 2));
console.log(JSON.stringify({ applied_patches: applied }, null, 2));
