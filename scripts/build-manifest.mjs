#!/usr/bin/env node
/**
 * Builds the unsigned payload from providers/ (+ adapters/ when present) and
 * writes build/payload.json. Nothing is signed and nothing is published here.
 *
 * Usage:
 *   node scripts/build-manifest.mjs [--sequence N] [--generated-at ISO]
 *                                   [--min-app-version 1.0.0]
 *
 * The sequence defaults to sequence.txt + 1. Pass --sequence to rebuild the
 * payload at a known sequence without touching the counter (handy when you only
 * want to diff two builds).
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT,
  BUILD_DIR,
  buildPayload,
  loadAdapters,
  loadProfiles,
  payloadText,
  readJson,
  readSequence,
  sortKeysDeep,
  log,
  fail,
} from './lib.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const profiles = loadProfiles();
const idCount = Object.keys(profiles).length;
if (idCount === 0) fail('providers/ is empty');

const adapters = loadAdapters();
const emergencyPath = join(ROOT, 'emergency.json');
const emergency = existsSync(emergencyPath)
  ? sortKeysDeep(readJson(emergencyPath))
  : { disableProviders: [], disableAdapters: [] };

const sequenceArg = arg('sequence');
const sequence = sequenceArg ? Number(sequenceArg) : readSequence() + 1;
if (!Number.isInteger(sequence) || sequence < 1) fail('sequence must be an integer >= 1');

const generatedAt = arg('generated-at', new Date().toISOString());
if (Number.isNaN(Date.parse(generatedAt))) fail(`--generated-at is not a date: ${generatedAt}`);

const payload = buildPayload({
  generatedAt,
  sequence,
  profiles,
  adapters,
  emergency,
  minAppVersion: arg('min-app-version', '1.0.0'),
});

mkdirSync(BUILD_DIR, { recursive: true });
const text = payloadText(payload);
writeFileSync(join(BUILD_DIR, 'payload.json'), text + '\n');

const bytes = Buffer.byteLength(text, 'utf8');
if (bytes > 512 * 1024) fail(`payload is ${bytes} bytes; the app rejects anything over 512 KB`);

const disabled = [
  ...(payload.emergency.disableProviders ?? []).map((id) => `${id} (provider)`),
  ...(payload.emergency.disableAdapters ?? []).map((id) => `${id} (adapter)`),
];

log(`built build/payload.json`);
log(`  sequence       ${sequence}${sequenceArg ? ' (pinned)' : ''}`);
log(`  generatedAt    ${generatedAt}`);
log(`  providers      ${idCount}`);
log(`  usage adapters ${Object.keys(adapters).length}`);
log(`  minAppVersion  ${payload.minAppVersion}`);
log(`  size           ${(bytes / 1024).toFixed(1)} KB`);
if (disabled.length) log(`  emergency      ${disabled.join(', ')}`);
log(``);
log(`next: npm run sign -- --key-file .keys/dev.key`);
