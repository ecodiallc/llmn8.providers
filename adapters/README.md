# adapters/

Reserved for declarative **read adapters** (`<providerId>.usage.json`).

A descriptor tells the app how to fetch and map a provider's usage response
without native code — the fix for "the endpoint moved" or "the field was
renamed". The grammar and limits are specified in
`notes/provider-manifest-design.md` §5 (app repo).

**Currently inert.** `build-manifest.mjs` passes any files here into
`payload.usageAdapters`, but no app version interprets them yet (design Phase 4).
Adding a file here today changes the payload and nothing else — do not expect a
behaviour change.

When descriptors are enabled, each one needs:

- an entry in `providers/<id>.json` with `adapter.mode: "descriptor"`;
- a recorded fixture under `fixtures/<id>/`;
- a contract test proving the descriptor produces the same rows as the native
  adapter for that fixture.

Until then, endpoint changes are app code changes.
