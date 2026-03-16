# Session Migration from Old Extension

**Priority:** P3
**Issue:** [#6090](https://github.com/Kilo-Org/kilocode/issues/6090)

## Remaining Work

- Investigate old extension session format (JSON in globalState, files on disk)
- Investigate CLI session format
- Determine if conversion is feasible with reasonable fidelity
- If feasible: offer to import old sessions, convert format, show count of imported/failed
- If not feasible: show a notice explaining old sessions are not accessible and where old data still lives
