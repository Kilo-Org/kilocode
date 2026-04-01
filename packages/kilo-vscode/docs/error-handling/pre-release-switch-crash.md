# CPU Spike / Crash When Switching Pre-Release <> Release

**Priority:** P0
**Issue:** [#6083](https://github.com/Kilo-Org/kilocode/issues/6083)

ServerManager has startup guards and process cleanup, but no explicit handling for version switch conflicts.

## Remaining Work

- Reproduce and profile CPU usage during release <> pre-release switch
- Check if both versions attempt to spawn `kilo serve` simultaneously causing port/race conflicts
- Ensure `deactivate()` fully terminates the server process before new version starts
- Check for file lock conflicts on shared state (e.g., `agent-manager.json`, CLI config)
