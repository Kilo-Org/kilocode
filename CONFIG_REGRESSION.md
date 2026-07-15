# Config Regression Review: PR #12204, Third Pass

Audited PR HEAD `790affb98f75832a33b680885e4d5fa7586a7290` against merge base `19bd048e21464f69b45e0d7a27c98a77037ebb08`.

## Finding

### Medium: V2 references do not reliably represent effective Kilo config

`KiloReference.sync()` now copies stable merged references into Core state, covering explicit, inline, profile, account, managed, linked-worktree, disabled-project, and precedence semantics. However, synchronization only runs while stable Agents initialize.

The reference endpoint directly lists Core state without invoking or awaiting sync. In the TUI, agent and reference requests begin concurrently, so provisional Core results can race effective synchronization. Direct API clients can always receive provisional results if Agent loading has not occurred.

Synchronization also drops `description` and `hidden`, which can expose hidden aliases and remove reference guidance.

Move reconciliation into reference initialization or the endpoint, await it before listing, and preserve all metadata. Add direct endpoint and TUI startup-order tests using effective-only Kilo config.

## Verified Fixes

- Relative local references again resolve from the worktree root, with the active directory used for non-project locations.
- Interactive-global and non-interactive `mcp add` target `KILO_CONFIG_DIR` when configured.
- Core discovery ignores `.opencode`, recognizes `.kilo` and `.kilocode`, and gives `.kilo` the intended precedence.
- Stable config, skill, TUI config, and theme discovery remain Kilo-only.

## Test Gaps

No test currently exercises `KiloReference.sync()` through its Agent call site, direct endpoint ordering, or `hidden`/`description` retention. MCP subprocess tests still cover only the default global path, not `KILO_CONFIG_DIR`.

This was a read-only Git-object audit; exact-head required CI passes.
