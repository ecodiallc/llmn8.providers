#!/usr/bin/env node
/**
 * Validates every profile in providers/ against the closed schema in the design
 * (notes/provider-manifest-design.md §4.4 and §4.5 in the app repo).
 *
 * Exits non-zero on the first run with any error; prints every problem it found
 * so one pass fixes them all. Run this before build/sign, and in CI.
 *
 * The rules live in scripts/contract.mjs so the fixture corpus tests the same
 * code path (scripts/contract-test.mjs).
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROVIDERS_DIR, loadProfiles, readJson, ROOT, log, fail } from './lib.mjs';
import { validateProfiles } from './contract.mjs';

const files = readdirSync(PROVIDERS_DIR).filter((f) => f.endsWith('.json'));
if (files.length === 0) fail('providers/ has no *.json profiles');

const profiles = loadProfiles();
const knownIds = readJson(join(ROOT, 'known-providers.json')).providers.map((p) => p.id);

const entries = files.map((file) => ({
  file,
  profile: profiles[file.replace(/\.json$/, '')],
  bytes: statSync(join(PROVIDERS_DIR, file)).size,
}));

const { errors, warnings } = validateProfiles(entries, knownIds);

if (warnings.length) {
  log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) log('  - ' + w);
}

if (errors.length) {
  log(`\n${errors.length} error(s):`);
  for (const e of errors) log('  - ' + e);
  process.exit(1);
}

log(`ok: ${files.length} profiles valid`);
