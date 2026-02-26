# CPU Spike / Crash When Switching Pre-Release ↔ Release

**Priority:** P0
**Status:** ❌ Not started
**Issue:** [#6083](https://github.com/Kilo-Org/kilocode/issues/6083)

## Problem

When users switch between the release and pre-release versions of the extension, VS Code crashes or experiences significant CPU consumption (2–3 minutes of high CPU) before recovering. This is a blocking issue for pre-release users.

## Remaining Work

- Reproduce: install the release version, then switch to pre-release (or vice versa) via the VS Code extensions panel
- Profile the CPU usage during the switch to identify what is spinning
- Hypothesis: both extension versions may attempt to spawn `kilo serve` simultaneously, causing port conflicts or race conditions in the process lifecycle code
- Check `ServerManager` for guard conditions: does it handle the case where a `kilo serve` process is already running (e.g., from the other version)?
- Ensure proper cleanup when the extension deactivates: the old version's `kilo serve` child process must be terminated before the new version starts
- Check for file lock conflicts on shared state (e.g., both versions trying to read/write `agent-manager.json` or the same CLI config)

## Implementation Notes

- The extension's `deactivate()` hook in `src/extension.ts` should fully terminate the server process and release any file handles
- Test by: (1) installing release, opening it, then switching to pre-release, and (2) the reverse
- The fix may be entirely in `ServerManager.ts` — ensure it kills the child process synchronously on deactivate
