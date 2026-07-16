# PR #12204 Kilo Test-Coverage Audit: Fourth Pass

Reviewed PR HEAD `627be20ed6ceb589316df9b54a2ae398146fd684` against actual merge base `e084ab7492eb6f330768157663b29c347dc0fa18`.

## Finding

### Medium: restored Kilo TUI modules lost direct regression coverage

The PR deletes all seven direct tests for the retained `packages/opencode/src/kilocode/plugins/sync-v2.tsx` implementation. New standalone TUI data tests exercise a different `DataProvider` and hydration implementation, so they do not protect the Kilo V2 debug plugin's buffering and hydration logic.

The focused `createLeadingTrailingSignal()` test was also removed while the helper remains in the restored session-switcher preview.

Restore direct tests for duplicate-event handling, hydration races, snapshot ordering, and leading/trailing scheduling in these retained modules.

## Verified Coverage

Previous gaps are resolved:

- Projector tests inspect raw compatibility rows.
- Reference tests cover metadata-preserving synchronization, first-request effective config, and config refresh.
- MCP subprocess coverage exercises `KILO_CONFIG_DIR` and default-profile isolation.
- FFF tests cover filesystem-root and home boundaries.
- OAuth tests exercise callback timeout.
- Credential tests cover active-selection dual-writing and legacy logout synchronization.
- Experimental plugin registration has registry coverage.

No PR-added skip or todo was found. Exact-head Linux, macOS, Windows, HttpApi, JetBrains, VS Code, typecheck, and visual checks pass, and unit artifacts were uploaded. This was a read-only source, CI-log, and artifact audit.
