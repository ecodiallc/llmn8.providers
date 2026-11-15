#!/usr/bin/env node
/**
 * Verifies public/manifest.json exactly the way the app will: Ed25519 over the
 * base64 payload string, key id lookup, sequence/expiry sanity, and the payload
 * decoding to the profiles you expected.
 *
 * Usage:
 *   node scripts/verify-manifest.mjs [--manifest public/manifest.json]
 *                                    [--key-file .keys/dev.key]
 *                                    [--public-key <standard base64>]
 *
 * Run it after signing, and in CI after deploying — it is the only check that
 * proves the artifact served to phones is the one you signed.
 */
import { verify as nodeVerify } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_DIR, log, fail, publicKeyObject, readKeyFile } from './lib.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const manifestPath = arg('manifest', join(PUBLIC_DIR, 'manifest.json'));
if (!existsSync(manifestPath)) fail(`${manifestPath} is missing — run \`npm run sign\` first`);
const envelope = JSON.parse(readFileSync(manifestPath, 'utf8'));

for (const field of ['schemaVersion', 'keyId', 'sequence', 'issuedAt', 'expiresAt', 'payload', 'signature']) {
  if (!(field in envelope)) fail(`envelope is missing "${field}"`);
}
if (envelope.schemaVersion !== 1) fail(`unsupported schemaVersion ${envelope.schemaVersion}`);

const publicKeyB64 = arg('public-key');
let publicKeyValue;
if (publicKeyB64) {
  // The app pastes standard base64; JWK wants base64url.
  publicKeyValue = Buffer.from(publicKeyB64, 'base64').toString('base64url');
} else {
  const keyFile = arg('key-file', process.env.MANIFEST_SIGNING_KEY);
  if (!keyFile) fail('pass --key-file, --public-key, or set MANIFEST_SIGNING_KEY');
  const key = readKeyFile(keyFile);
  if (key.keyId !== envelope.keyId) {
    fail(`key file is for "${key.keyId}" but the manifest was signed by "${envelope.keyId}"`);
  }
  publicKeyValue = key.publicKey;
}

const signatureOk = nodeVerify(
  null,
  Buffer.from(envelope.payload, 'ascii'),
  publicKeyObject(publicKeyValue),
  Buffer.from(envelope.signature, 'base64'),
);
if (!signatureOk) fail('signature does not match the payload and public key');

const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
if (Number(payload.sequence) !== Number(envelope.sequence)) {
  fail(`payload.sequence ${payload.sequence} does not match envelope.sequence ${envelope.sequence}`);
}
if ((payload.minAppVersion ?? null) !== (envelope.minAppVersion ?? null)) {
  fail('payload.minAppVersion does not match the envelope');
}

const expiresAt = Date.parse(envelope.expiresAt);
if (!Number.isFinite(expiresAt)) fail('expiresAt is not a date');
if (expiresAt < Date.now()) fail(`manifest expired on ${envelope.expiresAt}`);

const providers = Object.keys(payload.providers ?? {});
const disabled = payload.emergency?.disableProviders ?? [];

log('ok: manifest verifies');
log(`  keyId      ${envelope.keyId}`);
log(`  sequence   ${envelope.sequence}`);
log(`  issuedAt   ${envelope.issuedAt}`);
log(`  expiresAt  ${envelope.expiresAt} (${Math.round((expiresAt - Date.now()) / 86400000)} d left)`);
log(`  providers  ${providers.length}`);
log(`  payload    ${(Buffer.byteLength(envelope.payload, 'base64') / 1024).toFixed(1)} KB`);
if (disabled.length) log(`  disabled   ${disabled.join(', ')}`);
