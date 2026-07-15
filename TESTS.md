# PR #12204 Kilo Test-Coverage Audit: Third Pass

Reviewed PR HEAD `790affb98f75832a33b680885e4d5fa7586a7290` against merge base `19bd048e21464f69b45e0d7a27c98a77037ebb08`.

## Findings

### Medium: mixed-version projector storage lacks a raw-row assertion

`packages/core/src/session/projector.ts` now encodes projected messages for downgraded readers. Existing compatibility tests validate the helper and normalize rows before projector assertions, but no test inspects the raw `SessionMessageTable` row written by the projector or decodes it with the released schema.

Add projector-level raw compaction and tool-content assertions so removal of the encoder cannot leave tests green while breaking older readers.

### Medium: effective reference and MCP profile integration remain partially tested

No test executes `KiloReference.sync()` through the Agent call site, validates direct endpoint/startup ordering, or preserves `hidden` and `description`. MCP subprocess tests do not set `KILO_CONFIG_DIR` or assert the default path remains untouched.

These gaps directly cover the remaining config/pipeline finding and a newly fixed profile-routing branch.

### Low: new boundary branches lack focused coverage

- FFF broad scanning at exact filesystem-root and home locations has no direct test.
- The code-OAuth callback timeout is not exercised; the existing timeout test stalls credential persistence after callback completion.
- Active-credential switch dual-writing is not asserted in `auth.json`.

## Resolved Coverage

The former zero-task package gap is fixed. Exact-head logs report `Running test:ci in 24 packages` and `15 successful, 15 total`. JUnit artifacts include Core, LLM, and TUI; restored hydration tests execute rather than skip.

All earlier coverage findings remain resolved: Darwin profile validation, direct skill-picker tests, logger initialization, real-Git reference refresh, JUnit publication, and package CI. The latest changed tests add no skip or todo.

All required exact-head checks pass across Linux, macOS, Windows, HttpApi, JetBrains, VS Code, typechecks, and visual regression. This was a read-only source, CI-log, and artifact audit.
