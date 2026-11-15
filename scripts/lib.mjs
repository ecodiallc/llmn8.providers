/**
 * Shared helpers for the catalog build. No dependencies: Node's crypto module
 * does Ed25519 (>= 20) and the payload is plain JSON.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, createPublicKey } from 'node:crypto';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const PROVIDERS_DIR = join(ROOT, 'providers');
export const ADAPTERS_DIR = join(ROOT, 'adapters');
export const BUILD_DIR = join(ROOT, 'build');
export const PUBLIC_DIR = join(ROOT, 'public');

export const MANIFEST_SCHEMA_VERSION = 1;
export const MAX_VALIDITY_DAYS = 180;

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function readSequence() {
  const path = join(ROOT, 'sequence.txt');
  if (!existsSync(path)) return 0;
  const raw = readFileSync(path, 'utf8').trim();
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Profile files, sorted by id so the payload bytes are reproducible. */
export function loadProfiles() {
  if (!existsSync(PROVIDERS_DIR)) return {};
  const out = {};
  for (const file of readdirSync(PROVIDERS_DIR).filter((f) => f.endsWith('.json')).sort()) {
    out[file.replace(/\.json$/, '')] = readJson(join(PROVIDERS_DIR, file));
  }
  return out;
}

export function loadAdapters() {
  if (!existsSync(ADAPTERS_DIR)) return {};
  const out = {};
  for (const file of readdirSync(ADAPTERS_DIR).filter((f) => f.endsWith('.json')).sort()) {
    out[file.replace(/\.json$/, '')] = readJson(join(ADAPTERS_DIR, file));
  }
  return out;
}

/** Recursively sort object keys so two builds of the same input are identical. */
export function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeysDeep(value[k])]),
    );
  }
  return value;
}

/** The unsigned payload object, per design §4.3. */
export function buildPayload({ generatedAt, sequence, profiles, adapters, emergency, minAppVersion }) {
  return {
    manifestVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt,
    sequence,
    minAppVersion: minAppVersion ?? '1.0.0',
    emergency: emergency ?? { disableProviders: [], disableAdapters: [] },
    providers: sortKeysDeep(profiles),
    usageAdapters: sortKeysDeep(adapters),
  };
}

/** Stable JSON text for a payload object. */
export function payloadText(payload) {
  return JSON.stringify(sortKeysDeep(payload), null, 2);
}

/** Base64 of the payload text — this exact ASCII string is what gets signed. */
export function payloadBase64(payload) {
  return Buffer.from(payloadText(payload), 'utf8').toString('base64');
}

export function b64urlToBuffer(value) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function b64urlToB64(value) {
  return b64urlToBuffer(value).toString('base64');
}

/**
 * Key file shape written by `npm run keygen`:
 *   { keyId, privateKey, publicKey, createdAt }
 * with both keys base64url-encoded raw 32-byte values (JWK spelling), so the
 * app can load the public key with @noble/ed25519 unchanged.
 */
export function readKeyFile(pathOrJson) {
  const raw = pathOrJson.trim().startsWith('{') ? pathOrJson : readFileSync(pathOrJson, 'utf8');
  const key = JSON.parse(raw);
  for (const field of ['keyId', 'privateKey', 'publicKey']) {
    if (!key[field]) throw new Error(`key file is missing "${field}"`);
  }
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(key.keyId)) {
    throw new Error(`keyId "${key.keyId}" must be lowercase letters, digits and dashes`);
  }
  return key;
}

export function privateKeyObject(key) {
  return createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', d: key.privateKey, x: key.publicKey },
    format: 'jwk',
  });
}

export function publicKeyObject(base64url) {
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: base64url }, format: 'jwk' });
}

/** Standard base64 public key, ready to paste into the app's publicKeys.ts. */
export function publicKeyForApp(key) {
  return b64urlToB64(key.publicKey);
}

export function log(message) {
  process.stdout.write(message + '\n');
}

export function fail(message) {
  process.stderr.write('error: ' + message + '\n');
  process.exit(1);
}
