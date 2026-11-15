#!/usr/bin/env node
/**
 * Runs the whole pipeline in order, forwarding flags to each step:
 *   validate -> build -> sign -> verify
 *
 * Usage:
 *   node scripts/release.mjs --key-file .keys/dev-2026-11.key
 *   node scripts/release.mjs                # CI: key comes from MANIFEST_SIGNING_KEY
 *
 * Every step must succeed; the sequence counter only advances after a successful
 * sign, and the manifest is only written once the payload passed validation.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, log } from './lib.mjs';

const steps = [
  'scripts/validate.mjs',
  'scripts/build-manifest.mjs',
  'scripts/sign.mjs',
  'scripts/verify-manifest.mjs',
];

// Flags each step understands. Everything else is dropped with a warning so a
// forgotten flag fails loudly instead of being silently ignored.
const KNOWN = new Set([
  '--key-file',
  '--sequence',
  '--generated-at',
  '--min-app-version',
  '--expires-days',
  '--out',
  '--manifest',
  '--public-key',
  '--no-bump',
  '--allow-resign',
]);
const SUPPORTED_BY = {
  'scripts/validate.mjs': [],
  'scripts/build-manifest.mjs': ['--sequence', '--generated-at', '--min-app-version'],
  'scripts/sign.mjs': ['--key-file', '--expires-days', '--out', '--no-bump', '--allow-resign'],
  'scripts/verify-manifest.mjs': ['--key-file', '--public-key', '--manifest'],
};

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i];
  if (!KNOWN.has(token)) {
    log(`note: ignoring unknown flag ${token}`);
    continue;
  }
  const next = argv[i + 1];
  if (next && !next.startsWith('--')) {
    flags[token] = next;
    i += 1;
  } else {
    flags[token] = true;
  }
}

if (!flags['--key-file'] && !process.env.MANIFEST_SIGNING_KEY) {
  const guess = join(ROOT, '.keys', 'dev-2026-11.key');
  if (existsSync(guess)) {
    flags['--key-file'] = guess;
    log(`note: no --key-file given, using ${guess}`);
  }
}

for (const script of steps) {
  const args = [script];
  for (const [flag, value] of Object.entries(flags)) {
    if (!SUPPORTED_BY[script].includes(flag)) continue;
    args.push(flag);
    if (value !== true) args.push(value);
  }
  log(`\n$ node ${args.join(' ')}`);
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    process.stderr.write(`\nrelease stopped: ${script} exited ${result.status}\n`);
    process.exit(result.status ?? 1);
  }
}

log('\nrelease complete. Commit providers/, sequence.txt and any adapters/ changes, then push.');
