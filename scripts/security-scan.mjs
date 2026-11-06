#!/usr/bin/env node
/** Conservative, offline prepublication scan. Never prints a matched value. */
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const omitted = new Set(['node_modules', '.git', '.expo', 'dist', 'web-build', 'coverage', 'ios', 'android', '.wrangler', 'playwright-report', 'test-results', 'build']);
const lockfiles = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb']);
const findings = [];
const rules = [
  ['GitHub access token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/g],
  ['API secret', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/g],
  ['Slack access token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['AWS access identifier', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ['Credential URL', /https?:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/g],
  ['Literal credential', /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|session[_-]?token|cloudflare[_-]?api[_-]?token)\s*[:=]\s*["']([^"'\r\n]{20,})["']/gi],
];
function isPlaceholder(value) {
  return /(?:example|placeholder|redacted|synthetic|your[_ -]|fake[_ -]|test[_ -]|changeme|replace[_ -])/i.test(value)
    || /^([a-zA-Z0-9])\1{19,}$/.test(value);
}
function forbidden(path) {
  const name = path.split('/').at(-1);
  return ((name === '.env' || name.startsWith('.env.')) && !name.endsWith('.example'))
    || name === '.dev.vars' || name === 'credentials.json'
    || /\.(?:pem|p12|mobileprovision|key|keystore|jks|ipa|apk|aab|sqlite\d?(?:-.+)?|db(?:-.+)?|wav|mp3|m4a|caf|aiff|pcm)$/i.test(name)
    || /(?:^|\/)(?:private|imports|audio-cache)(?:\/|$)/.test(path);
}
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    const path = relative(root, full).replaceAll('\\', '/');
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!omitted.has(entry.name)) await walk(full);
      continue;
    }
    if (lockfiles.has(entry.name)) continue;
    if (forbidden(path)) { findings.push(`${path}: forbidden private/generated file`); continue; }
    if (['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.ttf', '.otf', '.woff', '.woff2'].includes(extname(path))) continue;
    if ((await stat(full)).size > 2 * 1024 * 1024) { findings.push(`${path}: oversized file needs manual review`); continue; }
    const bytes = await readFile(full);
    if (bytes.includes(0)) { findings.push(`${path}: unexpected binary needs manual review`); continue; }
    const content = bytes.toString('utf8');
    for (const [label, regex] of rules) {
      for (const match of content.matchAll(regex)) {
        if (isPlaceholder(match[1] ?? match[0])) continue;
        const line = content.slice(0, match.index).split('\n').length;
        findings.push(`${path}:${line}: ${label}`);
      }
    }
  }
}
// Ignored build directories are excluded from content scanning, but must never be tracked.
try {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
  for (const path of tracked) {
    if (forbidden(path) || /^(?:node_modules|dist|web-build|coverage|playwright-report|test-results|build|\.expo|\.wrangler)\//.test(path)) findings.push(`${path}: forbidden tracked artifact`);
  }
} catch { /* A new workspace can be scanned before git init. */ }
await walk(root);
if (findings.length) {
  process.stderr.write(`Security scan failed (${findings.length} findings; values withheld):\n${[...new Set(findings)].join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Security scan passed: no configured credential patterns or forbidden artifacts found. Manual review is still required.\n');
}
