# MemoryBank Migration

**Priority:** P1
**Issue:** [#6091](https://github.com/Kilo-Org/kilocode/issues/6091)

## Remaining Work

- Detect whether user has MemoryBank content in old extension's `workspaceState`
- Offer to migrate MemoryBank content to `AGENTS.md` in workspace root (or `~/.kilocode/rules/` for global rules)
- Show content for review before writing — do not silently overwrite existing `AGENTS.md`
- If `AGENTS.md` already exists, offer to append with a clear delimiter
- Show documentation explaining that `AGENTS.md` / rules files are the equivalent of MemoryBank
