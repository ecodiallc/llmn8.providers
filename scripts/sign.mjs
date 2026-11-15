#!/usr/bin/env node
/**
 * Wraps build/payload.json in the signed envelope and writes
 * public/manifest.json, then advances sequence.txt.
 *
 * Usage:
 *   node scripts/sign.mjs [--key-file .keys/dev.key] [--expires-days 90]
 *                         [--out public/manifest.json] [--no-bump]
 *
 * The key can also come from the MANIFEST_SIGNING_KEY environment variable,
 * either as a path or as the key JSON itself (that is how CI passes it).
 *
 * The signature covers the base64 payload string exactly as it appears in the
 * envelope (design §4.2), so nothing needs canonicalizing at verification time.
 */
import { sign as nodeSign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  BUILD_DIR,
  PUBLIC_DIR,
  ROOT,
  MAX_VALIDITY_DAYS,
  log,
  fail,
  privateKeyObject,
  publicKeyForApp,
  readKeyFile,
  readSequence,
} from './lib.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

/**
 * The app refuses to parse a manifest file above 700 KB (design §4.5), before
 * it spends work on base64 or JSON. That check is on the whole envelope on
 * disk, so it is enforced here on the bytes written — the 512 KB payload cap in
 * `build-manifest.mjs` does not bound the base64 copy plus the envelope.
 */
const MAX_MANIFEST_BYTES = 700 * 1024;

const payloadPath = join(BUILD_DIR, 'payload.json');
if (!existsSync(payloadPath)) fail('build/payload.json is missing — run `npm run build` first');
// Sign the exact bytes of build/payload.json: the envelope's payload decodes to
// the file a reviewer approved, with no re-serialization in between.
const payloadTextRaw = readFileSync(payloadPath, 'utf8').replace(/\n$/, '');
const payload = JSON.parse(payloadTextRaw);

const keySource = arg('key-file') ?? process.env.MANIFEST_SIGNING_KEY;
if (!keySource) {
  fail(
    'no signing key. Pass --key-file .keys/dev.key, or set MANIFEST_SIGNING_KEY ' +
      '(a path, or the key JSON from the Actions secret).',
  );
}
const key = readKeyFile(keySource);

const expiresDays = Number(arg('expires-days', '90'));
if (!Number.isFinite(expiresDays) || expiresDays < 1 || expiresDays > MAX_VALIDITY_DAYS) {
  fail(`--expires-days must be 1..${MAX_VALIDITY_DAYS}`);
}

const outPath = arg('out', join(PUBLIC_DIR, 'manifest.json'));

// Anti-rollback: never sign a sequence at or below what is already published.
if (existsSync(outPath)) {
  const current = JSON.parse(readFileSync(outPath, 'utf8'));
  if (Number(current.sequence) >= Number(payload.sequence)) {
    fail(
      `refusing to publish sequence ${payload.sequence}: ${outPath} already holds ` +
        `${current.sequence}. Roll back by editing the profiles and signing a higher sequence.`,
    );
  }
}
if (readSequence() >= Number(payload.sequence) && !hasFlag('allow-resign')) {
  fail(
    `sequence.txt is already ${readSequence()}, so ${payload.sequence} was published before. ` +
      `Run \`npm run build\` again (it increments), or pass --allow-resign to overwrite.`,
  );
}

const issuedAt = new Date();
const expiresAt = new Date(issuedAt.getTime() + expiresDays * 24 * 60 * 60 * 1000);
const payloadB64 = Buffer.from(payloadTextRaw, 'utf8').toString('base64');

const signature = nodeSign(null, Buffer.from(payloadB64, 'ascii'), privateKeyObject(key));

const envelope = {
  schemaVersion: 1,
  keyId: key.keyId,
  sequence: payload.sequence,
  issuedAt: issuedAt.toISOString(),
  expiresAt: expiresAt.toISOString(),
  minAppVersion: payload.minAppVersion,
  payload: payloadB64,
  signature: signature.toString('base64'),
};

mkdirSync(dirname(outPath), { recursive: true });
const envelopeText = JSON.stringify(envelope, null, 2) + '\n';
const envelopeBytes = Buffer.byteLength(envelopeText, 'utf8');
if (envelopeBytes > MAX_MANIFEST_BYTES) {
  fail(
    `refusing to write ${outPath}: the envelope is ${(envelopeBytes / 1024).toFixed(1)} KB, ` +
      `over the app's ${MAX_MANIFEST_BYTES / 1024} KB pre-parse cap. Trim profiles or extraMetrics.`,
  );
}
writeFileSync(outPath, envelopeText);

if (!hasFlag('no-bump')) {
  writeFileSync(join(ROOT, 'sequence.txt'), `${Math.max(readSequence(), payload.sequence)}\n`);
}

log(`signed ${outPath}`);
log(`  keyId      ${key.keyId}`);
log(`  sequence   ${payload.sequence}`);
log(`  expiresAt  ${envelope.expiresAt} (${expiresDays} d)`);
log(`  size       ${(envelopeBytes / 1024).toFixed(1)} KB`);
log('');
log('app public key (standard base64, paste into publicKeys.ts):');
log(`  ${publicKeyForApp(key)}`);
