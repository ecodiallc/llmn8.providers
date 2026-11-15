# Runbooks

Three procedures that must work under pressure. Each assumes:

- you are in the repo root (`/Volumes/external/llmn8.providers`);
- the `MANIFEST_SIGNING_KEY` Actions secret is set (CI signs; no laptop needs the
  production seed for a normal publish);
- "published" means pushed to `main` and deployed by Pages, which caches for
  about 10 minutes.

The app picks up a new manifest on cold start, on foreground after 6 h, or when
the user taps **Settings → Provider catalog → Check now**. There is no push
channel; "everyone has it" means "within one check".

Decode any published manifest to see what it actually says:

```bash
curl -s https://ecodiallc.github.io/llmn8.providers/manifest.json \
  | python3 -c 'import sys,json,base64; e=json.load(sys.stdin); p=json.loads(base64.b64decode(e["payload"])); print(json.dumps({"sequence": p["sequence"], "emergency": p["emergency"], "minAppVersion": p["minAppVersion"]}, indent=2))'
```

---

## R1 — A provider broke: disable it everywhere in under 10 minutes

**Symptom.** Sync failures, a provider returning wrong numbers, or rows that no
longer match its API. The read UI is showing something it should not.

**Decide first.**

| Want | Use |
|---|---|
| Stop the app offering models/usage/balance for a provider | `disableProviders` |
| Keep the provider but force the native adapter (only meaningful once descriptors are enabled; none are today) | `disableAdapters` |

**Steps.**

1. Edit `emergency.json` at the repo root (create it if it does not exist):

   ```json
   { "disableProviders": ["<provider-id>"], "disableAdapters": [] }
   ```

2. `npm run release` — contract-test, validate, build, sign, verify. Fix any
   complaint; do not hand-edit `sequence.txt`.

3. Commit and push:

   ```bash
   git add emergency.json sequence.txt
   git commit -m "emergency: disable <provider-id>"
   git push
   ```

4. Verify the deployed copy (allow ~2 min for the Actions run, then Pages):

   ```bash
   # the snippet at the top of this file: check "sequence" went up and
   # "emergency".disableProviders contains the id
   ```

5. In the app: **Settings → Provider catalog → Check now**. The provider's
   read UI is gone within one refresh; stored rows stay (the kill switch hides,
   it does not delete).

**Recover.** Remove the id from `emergency.json`, `npm run release`, commit both
files, push. Emergency entries are ordinary payloads: they never lower the
sequence, and a later publish without the entry re-enables the provider.

**If nothing changes in the app.** The manifest was not applied. Check the
catalog screen's status row: `minAppVersion` skip (a silent refusal — see
`min-app-version.txt`), signature/key mismatch, or a network failure. The
bundled baseline keeps working throughout; a rejected manifest cannot make things
worse.

---

## R2 — Rotate the signing key

**When.** A suspected leak, the 90-day validity window approaching, or a
planned handover.

**The rule that matters:** a new key signs nothing until an app build that
trusts it is in circulation. Reversing that order produces manifests every
build silently ignores.

**Steps.**

1. Generate on the machine that will hold the key only briefly:

   ```bash
   npm run keygen -- --key-id prod-YYYY-MM
   ```

   It prints the public key and writes `.keys/<key-id>.key` (git-ignored).

2. Add the public key to `publicKeys.ts` in the app repo **alongside** the old
   one and ship that build. Do not remove the old key yet.

3. Once the new build has replaced the old ones, move the new private key:

   - GitHub Actions secret `MANIFEST_SIGNING_KEY` (the key JSON, not a path);
   - the team password manager;
   - then delete `.keys/<key-id>.key` from the laptop.

4. Publish as usual: `npm run release`, commit `providers/` and `sequence.txt`,
   push. Never commit `.keys/`, `build/`, or `public/manifest.json`.

5. Verify the deployed manifest's `keyId`:

   ```bash
   curl -s https://ecodiallc.github.io/llmn8.providers/manifest.json \
     | python3 -c 'import sys,json; print(json.load(sys.stdin)["keyId"])'
   ```

6. Only after every build in circulation trusts both keys, remove the old entry
   from `publicKeys.ts` in the next app release.

**Blast radius of a leaked key.** Manifests signed by it stay valid until their
`expiresAt` — at most the validity window (90 days by default, 180 hard cap).
That is why manifests are re-signed monthly and why rotation, not revocation, is
the mitigation. Never extend the validity of a leaked key.

**Never.** Commit the seed; paste it into a chat, an issue, a CI log, or the
app; keep it on a machine that has the repo checked out longer than the
rotation itself.

---

## R3 — Roll back a bad manifest

**There is no downward sequence path.** By design the app rejects a manifest
whose `sequence` is not higher than both the last applied and the bundled
baseline, so "re-publish the old file" does not work. A rollback is a **new,
higher sequence** that restores the previous content.

**Steps.**

1. Find the bad change:

   ```bash
   git log --oneline -n 5 -- providers/ emergency.json
   ```

2. Restore the previous content without rewriting history:

   ```bash
   git revert --no-commit <bad-sha>     # or: git checkout <good-sha> -- providers/
   ```

3. Bump `rev` on every restored profile. Content changed relative to the bad
   publish, and `rev` is how the catalog screen shows that this provider's
   profile is not the one from the bad sequence.

4. `npm run release` — the sequence comes from `sequence.txt` + 1, so the new
   payload outranks the bad one. Commit `providers/`, `emergency.json` (if
   touched), and `sequence.txt`; push.

5. Verify the deployed copy with the snippet at the top: the sequence is higher
   than the bad publish, and the provider's `rev` is the restored one.

**If the catalog cannot build at all** (a broken profile blocks every publish),
do not fight the build: publish an emergency entry first (R1), which needs no
profile edit. That stops the damage in one small payload; fix the profile at
leisure.

**If CI itself is broken**, run `workflow_dispatch` with a `reason` — it takes
the same path and writes the reason into the run summary, so the Actions log
says why a sequence was published out of band.
