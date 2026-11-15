#!/usr/bin/env node
/**
 * Generates an Ed25519 keypair for signing manifests.
 *
 * Usage:
 *   node scripts/gen-key.mjs --key-id dev-2026-11 [--out .keys/dev.key]
 *
 * The file holds a base64url raw 32-byte private seed and the matching public
 * key. It is git-ignored on purpose. `.keys/` is for the local loop only — the
 * production key belongs in the Actions secret MANIFEST_SIGNING_KEY and in the
 * team password manager, never on a laptop that also runs `npm run sign` for
 * anything but a throwaway build.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, log, fail, publicKeyForApp } from './lib.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const keyId = arg('key-id');
if (!keyId) fail('pass --key-id, e.g. --key-id dev-2026-11');
if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(keyId)) {
  fail('keyId must be lowercase letters, digits and dashes (2..40 chars)');
}

const outPath = arg('out', join(ROOT, '.keys', `${keyId}.key`));
if (existsSync(outPath)) fail(`${outPath} already exists — delete it or choose another key id`);

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privJwk = privateKey.export({ format: 'jwk' });
const pubJwk = publicKey.export({ format: 'jwk' });

mkdirSync(dirname(outPath), { recursive: true });
const key = {
  keyId,
  privateKey: privJwk.d,
  publicKey: pubJwk.x,
  createdAt: new Date().toISOString(),
};
writeFileSync(outPath, JSON.stringify(key, null, 2) + '\n', { mode: 0o600 });
chmodSync(outPath, 0o600);

log(`wrote ${outPath} (mode 600, git-ignored)`);
log('');
log('public key for src/data/providers/manifest/publicKeys.ts:');
log('');
log(`  {`);
log(`    keyId: '${keyId}',`);
log(`    publicKeyBase64: '${publicKeyForApp(key)}',`);
log(`    notBefore: '${new Date().toISOString().slice(0, 10)}',`);
log(`    notAfter: null,`);
log(`  },`);
log('');
log(`sign with:  npm run sign -- --key-file ${outPath}`);
