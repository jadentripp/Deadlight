// Keep the exact engine version already used by the original game, self-hosted.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
const root = resolve('node_modules/three');
const seen = new Set();
async function copyModule(path) {
  path = resolve(path); if (seen.has(path)) return; seen.add(path);
  const rel = relative(root, path);
  if (rel.startsWith('..')) throw new Error('Module outside Three.js package');
  const dest = rel.startsWith('build/') ? 'vendor/' + rel.slice(6) : 'vendor/addons/' + rel.slice('examples/jsm/'.length);
  const source = await readFile(path, 'utf8');
  await mkdir(dirname(dest), {recursive:true}); await writeFile(dest, source);
  for (const [, spec] of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) if (spec.startsWith('.')) await copyModule(resolve(dirname(path), spec));
}
await copyModule(resolve(root, 'build/three.module.js'));
const game = await readFile('game.js', 'utf8');
for (const [, spec] of game.matchAll(/from 'three\/addons\/([^']+)'/g)) await copyModule(resolve(root, 'examples/jsm', spec));
await copyFile(resolve(root, 'LICENSE'), 'vendor/THREE-LICENSE.txt');
console.log(`Vendored ${seen.size} modules from Three.js 0.170.0.`);
