# llmn8.providers

The signed **provider catalog** for the Llmn8 app. It tells the app what each
provider can report about usage and cost, so a change in a provider's API can be
shipped by editing JSON here instead of rebuilding the app.

The app fetches `public/manifest.json` from GitHub Pages, verifies the Ed25519
signature against a key compiled into the binary, and applies the profiles at
runtime.

The app is pre-release with no existing users, so this is **core functionality**:
no feature flag, no shadow mode, no migration concerns. The bundled baseline is
only a fallback for a cold offline start or a rejected manifest.

- Manifest URL: `https://ecodiallc.github.io/llmn8.providers/manifest.json`
- Design and rationale: `notes/provider-manifest-design.md` in the app repo
- Where the facts come from: `notes/provider-data-limitations.md` and
  `notes/provider-api-viability.md` in the app repo
- Incidents: [RUNBOOKS.md](RUNBOOKS.md) — disable a provider in 10 minutes,
  rotate the signing key, roll back a bad manifest

> **This README is the process.** Follow it top to bottom for any update. Every
> command runs from the repo root.

---

## 1. Quick start

```bash
cd /Volumes/external/llmn8.providers
npm run release          # validate → build → sign → verify, using .keys/dev-2026-11.key
```

That produces `public/manifest.json` locally. Nothing is published until you
push. For a first-time setup, or after cloning on a new machine, see
[Signing keys](#5-signing-keys).

---

## 2. Repo layout

```
providers/<id>.json      one profile per provider — the files you edit
adapters/<id>.json       reserved for declarative read adapters (not enabled yet)
known-providers.json     the provider ids the app registers; ids must be in here
sequence.txt             last published sequence; never edit by hand
min-app-version.txt      oldest app version that reads the manifest (<= expo.version)
                         (the field contract is §3)
scripts/
  lib.mjs                shared helpers (payload build, key handling)
  contract.mjs           the closed profile contract, as code
  validate.mjs           runs the contract over providers/
  contract-test.mjs      runs the contract over fixtures/profiles/
  build-manifest.mjs     providers/ -> build/payload.json
  sign.mjs               payload -> public/manifest.json (envelope)
  verify-manifest.mjs    verifies a manifest the way the app does
  release.mjs            runs all five steps in order
  gen-key.mjs            creates an Ed25519 keypair
fixtures/profiles/       accept/reject corpus for the contract (cases.json)
build/payload.json       generated, git-ignored, reviewable before signing
public/manifest.json     generated, git-ignored, what gets served
.keys/                   dev signing keys, git-ignored
.github/workflows/       contract tests + validate + sign + deploy on push to main
```

The 16 provider profiles and `known-providers.json` were generated **once** from
the app's adapters (`accountSetupInfo.ts`, each provider's `info.capabilities`).
From then on this repo is the source of truth — the app does not regenerate them.

---

## 3. Editing a provider profile

Open `providers/<id>.json`. A full profile:

```jsonc
{
  "id": "novita",
  "displayName": "Novita AI",
  "rev": 1,                                  // bump when you change the file
  "docsUrl": "https://novita.ai/docs/api-reference/basic-billing",
  "capabilities": {
    "models": true,                          // provider has a model catalog
    "chat": true,                            // app can send completions
    "usage": true,                           // account usage sync exists
    "balance": true,                         // balance/credit endpoint exists
    "keyUsage": false                        // per-key attribution
  },
  "usage": {
    "syncMode": "native",                    // native | admin-key | enterprise-org | none
    "managementKeyRequired": false,
    "granularity": "daily",                  // per-request | hourly | daily | none
    "bucketTimezone": "utc",                 // utc | provider-local
    "reportingLagHours": null,               // documented lag, if any
    "revisionWindowDays": 1,                 // days the provider may rewrite
    "backfillMaxDays": 31,                   // how far back a sync can ask
    "syncThrottleMinutes": 5,
    "pagination": { "kind": "page", "maxPages": 4 }
  },
  "metrics": {
    "inputTokens":     { "availability": "reported" },
    "outputTokens":    { "availability": "reported" },
    "cachedTokens":    { "availability": "reported" },
    "reasoningTokens": { "availability": "reported" },
    "requestCount":    { "availability": "reported" },
    "costUsd":         { "availability": "reported" },
    "currency":        { "availability": "reported" },
    "latencyMs":       { "availability": "client_only" },
    "status":          { "availability": "client_only" }
  },
  "extraMetrics": {                          // optional, non-core numbers
    "neurons": { "availability": "reported" }
  },
  "actions": {
    "models": "enabled",                     // enabled | disabled
    "compare": "enabled",                    // needs chat + models
    "balance": "visible"                     // visible | hidden
  },
  "adapter": { "mode": "native", "usageSource": "novita-activity" },
  "setup": { "summaryKey": "providers.setupNovita" },
  "notes": "Bill API supports Hour/Day/Week/Month; the app requests Day."
}
```

### What each field drives in the app

| Field | Effect |
|---|---|
| `capabilities.models` | Shows/hides model list, Models and Compare actions. `false` means the provider genuinely has no catalog (Poe, Replicate, Cloudflare). |
| `capabilities.chat` | Whether completions can be sent. A manifest may only *narrow* this. |
| `capabilities.usage` | Gates usage sync, budgets coverage and the usage badge. |
| `capabilities.balance` | Shows/hides the balance card and low-balance alerts. |
| `capabilities.keyUsage` | Shows/hides per-key spend attribution. |
| `usage.syncMode` | The promise shown on the add-account sheet. Use `none` when sync needs user configuration (OpenAI-compatible). |
| `usage.granularity` | `daily` hides sub-day time ranges for that provider (the time of day is not stored). `per-request`/`hourly` keep it. |
| `usage.revisionWindowDays` | How many days the sync re-fetches to absorb provider revisions. |
| `usage.backfillMaxDays` | Clamp for the first/backfill sync window. |
| `usage.reportingLagHours` | Shown in freshness copy; use `null` when the provider documents none. |
| `metrics.*.availability` | Whether a number is shown, shown with a chip, or replaced by "not reported". |
| `metrics.costUsd.allocation` | `by_token_share` marks a provider total split across model rows as **allocated**. |
| `actions.*` | Hides the Models / Compare / balance affordances. Must agree with `capabilities` (validator enforces). |
| `adapter.usageSource` | The row source prefix for synced rows. **Do not change** it unless the app code changed too — the sync deletes rows by this prefix, so changing it duplicates history. |
| `setup.summaryKey` | i18n key for the add-account summary. Must exist in the app's translations. |
| `notes` | Free text for the next person. Say what is unusual about this provider. |

### Metric availability

| Value | Means | UI |
|---|---|---|
| `reported` | Provider API returns it faithfully | value |
| `estimated` | The app computes it | value + `est.` chip |
| `derived` | The app allocates a provider total across rows | value + `allocated` |
| `client_only` | Only app-sent calls produce it (always for `latencyMs`, `status`) | value + `app calls` |
| `not_reported` | API exists but omits the field | `—` + "not reported" |
| `not_supported` | No API for it at all | `—` + "unavailable" |

`reason` is a short diagnostic code (`provider_omits`, `no_api`, `neurons_only`,
`endpoint_dependent`, …). It is not user-facing copy. The validator warns when
`estimated`/`derived`/`not_reported`/`not_supported` has no reason.

---

## 4. Recipes

### "Provider X started reporting a new field"

1. `providers/x.json` → set that metric to `{"availability": "reported"}`
   (remove the `reason`).
2. If the app stores the new value in a fixed column **and the adapter already
   maps it**, you are done.
3. If it is a *new* number with no column (e.g. Cloudflare neurons), add it to
   `extraMetrics` instead — the app renders unknown extras generically.
4. Bump `rev`.
5. `npm run release` → commit → push.

### "Provider X stopped reporting a field"

Set it to `{"availability": "not_reported", "reason": "provider_omits"}`. Do this
**before** the field is removed upstream if you can, so the UI never shows a
stale or fake zero. Keep `costUsd` accurate: if costs are still returned, leave
it `reported`.

### "Provider X now needs a different key type"

Change `usage.syncMode` (`native` → `admin-key`) and
`usage.managementKeyRequired`. Update `setup.summaryKey` only if the app has a
matching i18n key — otherwise leave it and note the mismatch in `notes`.

### "Provider X's endpoint moved / response shape changed"

A **profile cannot fix this by itself.** Profiles describe *what the data means*,
not *how to fetch it*. Two options:

- Ship an app fix (native adapter) — the normal path today.
- Ship a descriptor in `adapters/x.json` — the declarative read adapter, which
  is designed for exactly this. It is not enabled in the app yet (design Phase 4);
  `adapters/` is passed through into the payload but has no effect.

Record the breakage as `not_reported` until a fix ships, so the UI stops
claiming data it cannot get.

### "Disable a provider everywhere, right now"

Edit `emergency.json` at the repo root (create it if absent):

```json
{ "disableProviders": ["cloudflare"], "disableAdapters": [] }
```

`npm run release` → push. Every app picks it up on the next manifest check
(cold start, foreground after 6 h, or a manual refresh). Remove the entry and
publish again to re-enable. **Emergency entries do not lower the sequence** —
they are just another published payload.

The full incident procedure, including verification and recovery, is
[runbook R1](RUNBOOKS.md#r1--a-provider-broke-disable-it-everywhere-in-under-10-minutes).

### "A new provider was added to the app"

A provider is onboarded by an **app build**, then a catalog entry — never by
this repo alone. The app owns the credential host allowlist, the adapter, and
the id list; a manifest only describes a provider the binary already knows.

1. Ship the app build that registers the provider (adapter, host allowlist,
   icon, i18n, its copy of this profile as the bundled baseline).
2. Add the id + display name to `known-providers.json`.
3. Create `providers/<id>.json` (copy the closest existing profile) and set
   every `metrics` entry honestly — this is the point of the catalog.
4. `npm run validate` — it cross-checks ids against `known-providers.json` and
   fails if any listed id has no file, or any file has an unknown id.
5. `npm run release` → commit → push.

Order matters only in one direction: publishing before the build is harmless
(old builds ignore an unknown id) but has no effect. See design §4.6.

### "Backfill or throttle is wrong for this provider"

Change `usage.backfillMaxDays` (0–90) or `usage.syncThrottleMinutes` (1–120).
The app clamps to its own 30-day default, so lowering below 30 is the effective
way to make a provider sync less.

---

## 5. The pipeline

```bash
npm run contract-test   # or: node scripts/contract-test.mjs
npm run validate        # or: node scripts/validate.mjs
npm run build           # or: node scripts/build-manifest.mjs
npm run sign -- --key-file .keys/dev-2026-11.key
npm run verify -- --key-file .keys/dev-2026-11.key
# or all five:
npm run release
```

### contract-test

Runs the accept/reject corpus in `fixtures/profiles/` through
`scripts/contract.mjs` — the exact function `validate` and CI use, so the corpus
tests the real validator rather than a copy of it. `cases.json` lists the
`accept` fixtures (must produce zero errors) and maps each `reject` fixture to
the error it must produce.

The contract is written twice: here, and in the app
(`src/domain/providerProfile.ts`, and `manifest/schema.ts` from Phase 3). If the
two drift, the app discards a manifest CI signed and every phone stays on the
old baseline — the worst failure mode in this pipeline, because there is no
error anywhere, only a publish that does nothing. Every rule added to
`contract.mjs` needs a `reject` case, so a later loosening is visible in review.

Fixtures are synthetic profiles that borrow real ids; the app repo has a
matching test (`src/data/providers/__tests__/baselineContract.test.ts`) that
checks the bundled baseline against the app's own half of the schema.

### validate

Checks every `providers/*.json` against the closed contract:

- ids match filenames and `known-providers.json`, and every known id has a file;
- closed enums for `syncMode`, `granularity`, `availability`, `actions`, …;
- numeric ranges (backfill, revision window, throttle, pages);
- unknown keys are errors — this is how typos are caught;
- cross-field rules: no catalog → `actions.models: disabled`; no balance →
  `balance: hidden`; no chat/catalog → `compare: disabled`; no usage API → cost
  and requests cannot be `reported`; `usage: true` → `granularity` and
  `usageSource` required; `usage: false` → `syncMode: none`;
- profile size ≤ 16 KB.

Exit code 1 with a list of every problem. It never writes anything.

### build

Fuses `providers/` (+ `adapters/`, + `emergency.json` if present) into
`build/payload.json`:

```json
{
  "manifestVersion": 1,
  "generatedAt": "…",
  "sequence": 2,
  "minAppVersion": "0.1.0",
  "emergency": { "disableProviders": [], "disableAdapters": [] },
  "providers": { "anthropic": { … }, … },
  "usageAdapters": {}
}
```

Object keys are sorted and the JSON is 2-space indented, so the same input
always produces the same bytes and a diff shows only what changed. The sequence
is `sequence.txt + 1`; the counter is not touched by `build`, only by `sign`.

Flags: `--sequence N` (pin), `--generated-at ISO`, `--min-app-version 0.2.0`.

`minAppVersion` comes from the committed `min-app-version.txt` unless
`--min-app-version` overrides it. It is the oldest app build that reads the
manifest — the release that ships the loader — and it must never be higher than
the app's `expo.version`, or every build treats the manifest as incompatible and
silently stays on the bundled baseline. Bump the file only when a payload needs
a newer app; changing it is itself a publish (the workflow watches it).

### sign

Wraps the payload in the envelope and writes `public/manifest.json`:

```json
{
  "schemaVersion": 1,
  "keyId": "prod-2026-11",
  "sequence": 2,
  "issuedAt": "…",
  "expiresAt": "…",
  "minAppVersion": "0.1.0",
  "payload": "<base64 of build/payload.json, byte for byte>",
  "signature": "<base64 Ed25519 over the payload's base64 string>"
}
```

The signature covers the **base64 string**, not a re-serialized object, which is
why verification in the app needs no canonicalization and why `build/payload.json`
is the exact thing you reviewed. On success it sets `sequence.txt` to the new
sequence.

Refuses to run when:

- no key is given (`--key-file` or `MANIFEST_SIGNING_KEY`);
- `public/manifest.json` already holds a sequence ≥ the one being signed (no
  downward rollback — to undo an update, edit the profiles back and sign a
  *higher* sequence);
- `sequence.txt` already reached this sequence (`--allow-resign` overrides, for
  rebuilding after a failed verify);
- `--expires-days` is outside 1..180;
- the envelope would exceed the app's **700 KB** file cap (§4.5). The app
  refuses to parse a manifest that big before doing any work, so signing one
  publishes an update no phone will ever read. The 512 KB payload limit in
  `build` is not the same bound: base64 adds a third, and the envelope adds the
  signature fields. Nothing is written and `sequence.txt` is not advanced.

Flags: `--expires-days 90` (default 90), `--out path`, `--no-bump`.

### verify

Re-runs the app's checks against a manifest — signature, key id, expiry,
sequence agreement, payload parse — and prints the summary. Run it after
signing, and again in CI **against the deployed URL**, so a stale CDN or a
deploy that silently didn't happen is caught before phones see it.

```bash
node scripts/verify-manifest.mjs --public-key 'Qei4rSp0Yu5mbNeBa4pAvSzFnEJsf7zIdbmm8zM8oHQ='
```

---

## 6. Signing keys

### Dev key (local loop)

Generated once on this machine, git-ignored:

```bash
npm run keygen -- --key-id dev-2026-11
```

It writes `.keys/dev-2026-11.key` (mode 600) and prints the public key to paste
into the app's `src/data/providers/manifest/publicKeys.ts`.

The app's `__DEV__` override reads the local `public/manifest.json` file directly
(`file:///Volumes/external/llmn8.providers/public/manifest.json`), so a profile
edit can be seen in the running app without pushing:

```bash
npm run release && # then reload the app; Settings → Provider catalog → Check now
```

A simulator can read that path; a physical device cannot, so the app falls back
to the remote URL there.

### Production key

Generated the same way, once, then:

- private key → the repo's Actions secret `MANIFEST_SIGNING_KEY` **and** the team
  password manager. Never in git, never on a laptop except when rotating.
- public key → `publicKeys.ts` in the app, in an app release that ships **before**
  the first manifest is signed with it.

`MANIFEST_SIGNING_KEY` may hold either a path or the key JSON itself; CI passes
the JSON.

### Rotation

1. `npm run keygen -- --key-id prod-2027-05`
2. Ship an app build whose `publicKeys.ts` trusts **both** the old and the new key.
3. Put the new key in `MANIFEST_SIGNING_KEY`; the next manifest is signed with it.
4. After every build in circulation trusts both keys, remove the old one from
   `publicKeys.ts`.

Cached manifests signed by a removed key stay valid until their `expiresAt`
(≤ 180 days) — that is the blast radius of a leaked key, which is why validity
defaults to 90 days and manifests are re-signed monthly.

---

## 7. Publishing

### Normal update (CI)

1. Edit `providers/<id>.json` (bump `rev`).
2. `npm run release` locally — fix anything `contract-test` or `validate`
   complains about.
3. Commit `providers/`, `sequence.txt` (and `emergency.json` if changed).
4. Push to `main`. CI re-runs contract-test → validate → build → sign → verify,
   verifies the **deployed** URL, and publishes to Pages.

`workflow_dispatch` runs the same path with an optional `reason`, which is
written to the run summary — use it for emergency publishes so the Actions log
says why.

`public/manifest.json` and `build/` are git-ignored: CI builds and deploys them
as a Pages artifact. Do not commit generated manifests.

`sequence.txt` **is** committed — it is the counter CI reads to pick the next
sequence.

### Manual / local

```bash
npm run release
python3 -m http.server 8080 --directory public   # serve locally
# app dev override: file:///Volumes/external/llmn8.providers/public/manifest.json
```

### Why the URL shape

`https://ecodiallc.github.io/llmn8.providers/manifest.json` — GitHub Pages,
public repo, source **GitHub Actions**. Pages caches for ~10 minutes, which the
app absorbs with stale-while-revalidate. Never point the app at
`api.github.com`: 60 unauthenticated requests/hour, and an authenticated request
would need a token inside the app.

---

## 8. What the app does with the manifest

1. **Cold start:** read the cached manifest (AsyncStorage + SQLite); if valid,
   apply it; otherwise apply the bundled baseline. No network on the critical
   path, no first-paint delay.
2. **Refresh:** fetch with `If-None-Match` when the cache is older than 24 h (or
   6 h on foreground). Reject if signature, key id, sequence, expiry or schema
   fails, keeping the last good manifest.
3. **Apply:** replace the provider profiles used by screens, sync and budgets;
   never touch credential destinations (the host allowlist lives in the binary).
4. **Report:** Settings → Provider catalog shows sequence, key id, expiry, source
   (bundled / cached / remote) and a per-provider `rev`; `audit_log` records
   applied/rejected/fetch-failed with a reason code.

**The app rejects the whole manifest if any profile is invalid**, so a bad
provider file fails the build in CI rather than half-applying in the field.

---

## 9. Rules that will bite you

- **Sequence only goes up.** Rollback = publish the old *content* at a higher
  sequence.
- **Validity ≤ 180 days.** Default 90; re-sign before `expiresAt` or apps fall
  back to the bundled baseline.
- **Ids are fixed at build time.** No new provider without an app release that
  registers it and allows its host.
- **A profile cannot change a URL, host, credential destination or auth scheme.**
  That is deliberate: a compromised catalog must not be able to redirect keys.
  Endpoint changes need code, or a descriptor once Phase 4 ships.
- **Do not touch `adapter.usageSource`.** The sync deletes rows by that prefix.
- **Do not hand-edit `sequence.txt`.** Let `sign` advance it.
- `extraMetrics` is for numbers with no column in the app; unknown extras render
  generically, so adding one is safe.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `id "x" is not in known-providers.json` | Add it there, or fix the typo in the file name/id. |
| `usage capability is true, so adapter.usageSource is required` | Give the source prefix the native adapter uses. |
| `no model catalog, so actions.models must be "disabled"` | Capabilities and actions disagree; the validator keeps them honest. |
| `sequence.txt is already N` | You rebuilt without changing anything. Edit a profile, or run `npm run build` normally (it increments). |
| `refusing to write …: the envelope is N KB` | The signed file crossed the app's 700 KB cap; the app would ignore it. Trim profiles or `extraMetrics` — a profile is meant to be ≤ 16 KB. |
| `refusing to publish sequence N` | The local `public/manifest.json` is newer than what you are signing. Delete it (it is git-ignored) or sign a higher sequence. |
| `signature does not match the payload` on verify | Wrong key, or `public/manifest.json` was regenerated by other means. Re-run sign, then verify with the same key. |
| App still shows the old profile | Pages cache (~10 min) + the app's 6 h foreground refresh. Use Settings → Check now, or append `?v=<sequence>` when testing. |
| Manifest ignored after a deploy | Check `minAppVersion` (older builds skip silently) and `expiresAt`. A `minAppVersion` above the app's `expo.version` makes every build ignore the manifest — the classic first-publish mistake; fix `min-app-version.txt` and publish again. |

---

## 11. Update checklist

Same icons as the app's design doc: 🔲 not started · 🟡 in progress · ✅ done ·
⛔ blocked. Change the icon as you go — do not use `[x]`.

```
🔲 edit providers/<id>.json and bump rev
🔲 note in `notes` what changed upstream and the date verified
🔲 add or update a fixture in fixtures/profiles/ if the contract changed
🔲 npm run release   (contract-test → validate → build → sign → verify)
🔲 npm run verify   (after deploy, against the URL)
🔲 commit providers/, sequence.txt, emergency.json if touched
🔲 push to main; watch CI; confirm the served sequence incremented
🔲 update notes/provider-data-limitations.md in the app repo if the app-side
   behaviour changed (it is the human-readable mirror of these profiles)
```

Emergency path: edit `emergency.json` → `npm run release` → push → confirm the
served sequence. Do not skip `verify`.
