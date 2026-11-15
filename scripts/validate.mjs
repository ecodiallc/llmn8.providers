#!/usr/bin/env node
/**
 * Validates every profile in providers/ against the closed schema in the design
 * (notes/provider-manifest-design.md §4.4 and §4.5 in the app repo).
 *
 * Exits non-zero on the first run with any error; prints every problem it found
 * so one pass fixes them all. Run this before build/sign, and in CI.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROVIDERS_DIR, loadProfiles, readJson, ROOT, log, fail } from './lib.mjs';

const PROFILE_MAX_BYTES = 16 * 1024;

const SYNC_MODES = ['native', 'admin-key', 'enterprise-org', 'none'];
const GRANULARITIES = ['per-request', 'hourly', 'daily', 'none'];
const BUCKET_TIMEZONES = ['utc', 'provider-local'];
const PAGINATION_KINDS = ['none', 'cursor', 'offset', 'page'];
const AVAILABILITIES = [
  'reported',
  'estimated',
  'derived',
  'client_only',
  'not_reported',
  'not_supported',
];
const ALLOCATIONS = ['none', 'by_token_share'];
const ACTION_STATES = ['enabled', 'disabled'];
const BALANCE_STATES = ['visible', 'hidden'];
const ADAPTER_MODES = ['native', 'descriptor'];

const REQUIRED_METRICS = [
  'inputTokens',
  'outputTokens',
  'cachedTokens',
  'reasoningTokens',
  'requestCount',
  'costUsd',
  'currency',
  'latencyMs',
  'status',
];

const PROFILE_KEYS = [
  'id',
  'displayName',
  'rev',
  'docsUrl',
  'capabilities',
  'usage',
  'metrics',
  'extraMetrics',
  'actions',
  'adapter',
  'setup',
  'notes',
];
const CAPABILITY_KEYS = ['models', 'chat', 'usage', 'balance', 'keyUsage'];
const USAGE_KEYS = [
  'syncMode',
  'managementKeyRequired',
  'granularity',
  'bucketTimezone',
  'reportingLagHours',
  'revisionWindowDays',
  'backfillMaxDays',
  'syncThrottleMinutes',
  'pagination',
];
const METRIC_KEYS = ['availability', 'reason', 'allocation'];
const ACTION_KEYS = ['models', 'compare', 'balance'];
const ADAPTER_KEYS = ['mode', 'usageSource'];

const known = new Set(readJson(join(ROOT, 'known-providers.json')).providers.map((p) => p.id));
const errors = [];
const warn = [];

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);

function checkKeys(label, value, allowed, required = allowed) {
  if (!isObject(value)) {
    errors.push(`${label}: must be an object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label}: unknown key "${key}" (typo?)`);
  }
  for (const key of required) {
    if (!(key in value)) errors.push(`${label}: missing "${key}"`);
  }
  return true;
}

function checkEnum(label, value, allowed) {
  if (!allowed.includes(value)) {
    errors.push(`${label}: "${value}" is not one of ${allowed.join(' | ')}`);
  }
}

function checkMetric(label, metric) {
  if (!checkKeys(label, metric, METRIC_KEYS, ['availability'])) return;
  checkEnum(`${label}.availability`, metric.availability, AVAILABILITIES);
  if (metric.reason !== undefined && typeof metric.reason !== 'string') {
    errors.push(`${label}.reason: must be a string code`);
  }
  if (metric.allocation !== undefined) {
    checkEnum(`${label}.allocation`, metric.allocation, ALLOCATIONS);
  }
  if (
    ['estimated', 'not_reported', 'not_supported', 'derived'].includes(metric.availability) &&
    !metric.reason
  ) {
    warn.push(`${label}: "${metric.availability}" without a reason code (diagnostics only)`);
  }
}

function validateProfile(file, profile) {
  const at = `providers/${file}`;
  if (!checkKeys(at, profile, PROFILE_KEYS, [
    'id',
    'displayName',
    'rev',
    'docsUrl',
    'capabilities',
    'usage',
    'metrics',
    'actions',
    'adapter',
    'setup',
    'notes',
  ])) return;

  if (profile.id !== file.replace(/\.json$/, '')) {
    errors.push(`${at}: id "${profile.id}" must match the filename`);
  }
  if (!known.has(profile.id)) {
    errors.push(`${at}: id "${profile.id}" is not in known-providers.json`);
  }
  if (typeof profile.displayName !== 'string' || !profile.displayName) {
    errors.push(`${at}.displayName: required string`);
  }
  if (!isInt(profile.rev) || profile.rev < 1) errors.push(`${at}.rev: integer >= 1`);
  if (profile.docsUrl !== null && typeof profile.docsUrl !== 'string') {
    errors.push(`${at}.docsUrl: string or null`);
  }
  if (typeof profile.notes !== 'string' || !profile.notes) {
    errors.push(`${at}.notes: required — say what makes this provider's data unusual`);
  }

  const cap = profile.capabilities;
  if (checkKeys(`${at}.capabilities`, cap, CAPABILITY_KEYS)) {
    for (const key of CAPABILITY_KEYS) {
      if (typeof cap[key] !== 'boolean') {
        errors.push(`${at}.capabilities.${key}: must be true or false`);
      }
    }
  }

  const usage = profile.usage;
  if (checkKeys(`${at}.usage`, usage, USAGE_KEYS)) {
    checkEnum(`${at}.usage.syncMode`, usage.syncMode, SYNC_MODES);
    checkEnum(`${at}.usage.granularity`, usage.granularity, GRANULARITIES);
    checkEnum(`${at}.usage.bucketTimezone`, usage.bucketTimezone, BUCKET_TIMEZONES);
    if (typeof usage.managementKeyRequired !== 'boolean') {
      errors.push(`${at}.usage.managementKeyRequired: must be true or false`);
    }
    if (usage.reportingLagHours !== null && !(typeof usage.reportingLagHours === 'number')) {
      errors.push(`${at}.usage.reportingLagHours: number or null`);
    }
    if (isInt(usage.revisionWindowDays) === false || usage.revisionWindowDays < 0 || usage.revisionWindowDays > 7) {
      errors.push(`${at}.usage.revisionWindowDays: integer 0..7`);
    }
    if (isInt(usage.backfillMaxDays) === false || usage.backfillMaxDays < 0 || usage.backfillMaxDays > 90) {
      errors.push(`${at}.usage.backfillMaxDays: integer 0..90`);
    }
    if (isInt(usage.syncThrottleMinutes) === false || usage.syncThrottleMinutes < 1 || usage.syncThrottleMinutes > 120) {
      errors.push(`${at}.usage.syncThrottleMinutes: integer 1..120`);
    }
    const pg = usage.pagination;
    if (checkKeys(`${at}.usage.pagination`, pg, ['kind', 'maxPages'])) {
      checkEnum(`${at}.usage.pagination.kind`, pg.kind, PAGINATION_KINDS);
      if (isInt(pg.maxPages) === false || pg.maxPages < 1 || pg.maxPages > 20) {
        errors.push(`${at}.usage.pagination.maxPages: integer 1..20`);
      }
    }
    // Consistency between capabilities and the usage block.
    if (cap?.usage === false) {
      if (usage.syncMode !== 'none') errors.push(`${at}: usage capability is false, so syncMode must be "none"`);
      if (usage.granularity !== 'none') errors.push(`${at}: usage capability is false, so granularity must be "none"`);
    }
    if (cap?.usage === true && usage.granularity === 'none') {
      errors.push(`${at}: usage capability is true, so granularity cannot be "none"`);
    }
    // An adapter-backed sync source is required whenever usage is claimed.
    if (cap?.usage === true) {
      if (!profile.adapter?.usageSource) {
        errors.push(`${at}: usage capability is true, so adapter.usageSource is required`);
      }
    }
  }

  const metrics = profile.metrics;
  if (checkKeys(`${at}.metrics`, metrics, REQUIRED_METRICS, REQUIRED_METRICS)) {
    for (const key of REQUIRED_METRICS) checkMetric(`${at}.metrics.${key}`, metrics[key]);
  }
  if (profile.extraMetrics !== undefined) {
    if (!isObject(profile.extraMetrics)) {
      errors.push(`${at}.extraMetrics: must be an object of metric entries`);
    } else {
      for (const [key, metric] of Object.entries(profile.extraMetrics)) {
        checkMetric(`${at}.extraMetrics.${key}`, metric);
      }
    }
  }

  const actions = profile.actions;
  if (checkKeys(`${at}.actions`, actions, ACTION_KEYS)) {
    checkEnum(`${at}.actions.models`, actions.models, ACTION_STATES);
    checkEnum(`${at}.actions.compare`, actions.compare, ACTION_STATES);
    checkEnum(`${at}.actions.balance`, actions.balance, BALANCE_STATES);
  }

  const adapter = profile.adapter;
  if (checkKeys(`${at}.adapter`, adapter, ADAPTER_KEYS)) {
    checkEnum(`${at}.adapter.mode`, adapter.mode, ADAPTER_MODES);
    if (adapter.usageSource !== null && typeof adapter.usageSource !== 'string') {
      errors.push(`${at}.adapter.usageSource: string or null`);
    }
  }

  // Cross-field rules that keep the UI honest.
  if (cap && actions) {
    if (cap.models === false && actions.models !== 'disabled') {
      errors.push(`${at}: no model catalog, so actions.models must be "disabled"`);
    }
    if (cap.balance === false && actions.balance !== 'hidden') {
      errors.push(`${at}: no balance endpoint, so actions.balance must be "hidden"`);
    }
    if ((cap.chat === false || cap.models === false) && actions.compare !== 'disabled') {
      errors.push(`${at}: compare needs chat + a model catalog, so actions.compare must be "disabled"`);
    }
  }
  if (cap && metrics) {
    if (cap.usage === false && metrics.costUsd?.availability === 'reported') {
      errors.push(`${at}: no usage API, so costUsd cannot be "reported"`);
    }
    if (cap.usage === false && metrics.requestCount?.availability === 'reported') {
      errors.push(`${at}: no usage API, so requestCount cannot be "reported"`);
    }
  }

  const bytes = statSync(join(PROVIDERS_DIR, file)).size;
  if (bytes > PROFILE_MAX_BYTES) {
    errors.push(`${at}: ${bytes} bytes exceeds the ${PROFILE_MAX_BYTES} byte limit`);
  }
}

const files = readdirSync(PROVIDERS_DIR).filter((f) => f.endsWith('.json'));
const profiles = loadProfiles();

if (files.length === 0) fail('providers/ has no *.json profiles');

for (const file of files) validateProfile(file, profiles[file.replace(/\.json$/, '')]);

for (const id of known) {
  if (!profiles[id]) errors.push(`known-providers.json lists "${id}" but providers/${id}.json is missing`);
}

if (warn.length) {
  log(`\n${warn.length} warning(s):`);
  for (const w of warn) log('  - ' + w);
}

if (errors.length) {
  log(`\n${errors.length} error(s):`);
  for (const e of errors) log('  - ' + e);
  process.exit(1);
}

log(`ok: ${files.length} profiles valid`);
