# CLI fixture-storage incident — 2026-09-07

The user reported test labels in `/connect` and Zen instead of anonymous Kilo
models. The user clarified that `/connect` itself did not throw an error.

## Confirmed cause and impact

Direct development invocations of `gateway-scope-acceptance-fixture.ts` and
`sidebar-bench-ui-fixture.tsx` bypassed their test wrappers. Both entries called
`layout("interactive")` and imported dummy credentials with the ambient storage
environment. Their wrapper processes supplied temporary HOME/XDG directories,
but direct invocations did not. A temporary project directory alone did not
isolate the credential database. The writing delegate confirmed these commands.

Read-only inspection of the real interactive database found 39 credentials
labelled `Scope acceptance fixture` and 20 labelled `Bench fixture`; a Bench
fixture was active. The original `Kilo` credential was also present. Earlier
claims that all development runs were isolated are retracted. Wrapper test
success did not establish safety of direct fixture entrypoints.

## Authorized recovery

After the user's explicit approval, a SQLite online backup was created in a
mode-0700 private thread-storage directory, with the database file mode 0600.
The backup passed `PRAGMA quick_check` and contained the expected 60 records.

Backup: `/Users/johnnyamancio/.bb/thread-storage/thr_qr9z7p3cqc/credential-recovery-20rbKX/before-cleanup.db`.
It contains credentials: do not publish, attach, or commit it.

One transaction deleted exactly 59 records, requiring integration `kilo`, key
credential type, and both the exact fixture label and corresponding known dummy
key. The remaining original `Kilo` record was compared with the backup: its ID,
credential value, and active flag were unchanged. No original credential was
activated or replaced; no sessions or other tables were deleted. The deleted
records are recoverable from the backup. This is credential cleanup, not a claim
that fixture-created sessions or all other historical test state were removed.

## Separate product defect

The Gateway refresh path required a credential and profile before fetching a
catalog. Consequently there was no anonymous Kilo catalog, while the native Zen
catalog could remain selectable. Fixture cleanup does not by itself fix this.

## Implemented correction

`test/fixture.ts` supplies an explicit wrapper root and exports
`guardedFixtureLayout()`. The guard checks the actual resolved interactive layout
against that root, canonicalizing existing ancestors to reject symlink escapes.
It does not merely trust changed environment variables after module import.
All six fixture entrypoints using `importCredential`, plus the model-picker
fixture using the public credential-creation API, call it before host launch.
The new anonymous-host fixture uses the same guard. Direct entrypoints without
the marker refuse; normal test wrappers supply isolated paths.

Gateway catalog reads now omit Authorization when there is no credential, skip
the authenticated profile path, and retain only records marked `isFree: true`
by the server. The public endpoint was read without credentials: all 371 records
carried `isFree`, of which 19 were true (18 also passed the existing tools-support
gate). This is deliberately stricter than v1, which listed paid records too.
Inference uses v1's literal anonymous key, without persisting a credential.
The metadata RPC supports the same anonymous catalog. Empty or failed anonymous
reads do not expose seed models or fall back to the upstream public Zen offer.
Authenticated Kilo account paths remain separate.

Zen suppression recognizes upstream's public-key marker, not arbitrary provider
credentials. The real-host regression seeds the actual native provider plugin
and asserts its uncredentialed offer is absent; this catches a future change to
that upstream behavior. Configured-key and authenticated Zen cases have separate
unit coverage. No Core or shared TUI edits were needed.

The authenticated scope/bench/model-info/picker fake gateways now return an empty
catalog only for the unauthenticated public startup request. Their exact Bearer
checks remain for authenticated and organization requests.

## Verification and pending work

- Gateway unit suite: 32 passed / 383 assertions; package typecheck clean.
- Real-host anonymous scenarios: available catalog with successful loopback
  inference, empty catalog, and HTTP 503; all three passed. No paid inference.
- Guard coverage includes missing root, safe root, escaped paths, symlinks, and
  actual direct invocation of all seven credential-writing entrypoints under
  disposable HOME directories, asserting that no credential database is created.
- Final combined CLI regression: 27 passed / 0 failed / 79 assertions across
  nine files (45.85 seconds), bundled Bun 1.4.0; package typecheck clean.
- All 16 changed/new TypeScript files in this incident passed Prettier checks.
- After verification, the real credential database still had only the original
  `Kilo` record; ID, credential value, and active flag again matched the backup.
- No real-credential request or unrelated credential cleanup was performed.

Pending for later: audit non-credential-writing direct host fixtures for the same
storage discipline; inspect/remove other historical fixture state only with an
explicitly scoped recovery request; rebuild/reverify portable artifacts before
distributing them. Exact anonymous Auto-Free default ordering is not imposed by
this correction: Kilo free models replace uncredentialed Zen, while native model
ordering remains. Explicit per-model/variant API-key configuration still wins
over provider-level settings. No whole-row parity credit is claimed.
