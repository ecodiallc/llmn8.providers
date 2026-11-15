#!/usr/bin/env node
/**
 * Runs the accept/reject corpus in fixtures/profiles/ through scripts/contract.mjs
 * — the same validator `npm run validate` and CI use.
 *
 * Why this exists: the contract is written twice, once here and once in the app
 * (src/domain/providerProfile.ts, later manifest/schema.ts). If the two drift,
 * the app throws away a manifest CI signed and nobody gets the fix. The corpus
 * pins the behaviours that are easy to loosen by accident — an unknown key, an
 * enum value added on one side, a range widened on one side.
 *
 * Usage:
 *   node scripts/contract-test.mjs            # run the corpus
 *   node scripts/contract-test.mjs --list     # print the cases only
 *
 * Every `accept` case must validate with no errors; every `reject` case must
 * produce the error text listed for it in cases.json. Exit code 1 on any miss.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, log } from './lib.mjs';
import { validateProfiles } from './contract.mjs';

const FIXTURES = join(ROOT, 'fixtures', 'profiles');
const casesPath = join(FIXTURES, 'cases.json');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const cases = readJson(casesPath);
const knownIds = readJson(join(ROOT, 'known-providers.json')).providers.map((p) => p.id);

if (process.argv.includes('--list')) {
  log(`${cases.accept.length} accept, ${Object.keys(cases.reject).length} reject`);
  for (const rel of cases.accept) log(`  accept  ${rel}`);
  for (const rel of Object.keys(cases.reject)) log(`  reject  ${rel}`);
  process.exit(0);
}

function load(rel) {
  const path = join(FIXTURES, rel);
  const profile = readJson(path);
  // The corpus supplies its own ids: a fixture is not a published provider.
  if (typeof profile.id === 'string') knownIds.push(profile.id);
  return {
    file: rel.split('/').pop(),
    profile,
    bytes: statSync(path).size,
  };
}

const failures = [];

for (const rel of cases.accept) {
  const { errors } = validateProfiles([load(rel)], knownIds, { requireEveryKnownId: false });
  if (errors.length) {
    failures.push(`${rel}: expected to be accepted, got ${errors.length} error(s):\n    ${errors.join('\n    ')}`);
  } else {
    log(`ok  accept  ${rel}`);
  }
}

for (const [rel, expected] of Object.entries(cases.reject)) {
  const { errors } = validateProfiles([load(rel)], knownIds, { requireEveryKnownId: false });
  if (!errors.some((error) => error.includes(expected))) {
    const got = errors.length ? `\n    errors seen:\n    ${errors.join('\n    ')}` : '\n    no errors seen';
    failures.push(`${rel}: expected an error containing:\n    ${expected}${got}`);
  } else {
    log(`ok  reject  ${rel}`);
  }
}

// A fixture directory nobody listed is a case nobody runs.
const listed = new Set([...cases.accept, ...Object.keys(cases.reject)].map((rel) => rel.split('/').pop()));
const onDisk = ['accept', 'reject'].flatMap((dir) =>
  readdirSync(join(FIXTURES, dir)).filter((f) => f.endsWith('.json')),
);
for (const file of onDisk) {
  if (!listed.has(file)) failures.push(`fixtures/profiles/*/${file} is not listed in cases.json`);
}

if (failures.length) {
  log(`\n${failures.length} contract failure(s):`);
  for (const failure of failures) log('  - ' + failure);
  process.exit(1);
}

log(`\nok: ${cases.accept.length + Object.keys(cases.reject).length} contract cases pass`);
