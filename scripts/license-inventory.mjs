#!/usr/bin/env node
// Inventory installed packages without contacting registries or reading environment secrets.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const direct = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }));
const packages = [];
for (const [location, info] of Object.entries(lock.packages || {})) {
  if (!location || !location.includes('node_modules/')) continue;
  let installed;
  try { installed = JSON.parse(await readFile(resolve(root, location, 'package.json'), 'utf8')); } catch { installed = {}; }
  const name = installed.name || location.split('node_modules/').at(-1);
  packages.push({ name, version: info.version || installed.version || null, license: installed.license || info.license || 'UNSPECIFIED: review package LICENSE', direct: location === `node_modules/${name}` && direct.has(name), development: !!info.dev, repository: typeof installed.repository === 'string' ? installed.repository : installed.repository?.url || null });
}
packages.sort((a, b) => a.name.localeCompare(b.name) || String(a.version).localeCompare(String(b.version)));
const out = { generatedFrom: 'package-lock.json and installed package manifests; not a legal opinion', packages };
await writeFile(resolve(root, 'docs/dependency-licenses.json'), JSON.stringify(out, null, 2) + '\n');
const unknown = packages.filter(p => String(p.license).startsWith('UNSPECIFIED'));
process.stdout.write(`Recorded ${packages.length} resolved package entries (${packages.filter(p => p.direct).length} direct); ${unknown.length} need explicit license review.\n`);
if (unknown.length) process.stdout.write(unknown.map(p => `${p.name}@${p.version}`).join('\n') + '\n');
