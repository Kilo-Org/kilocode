# MemoryBank Migration

**Priority:** P1
**Status:** 🔨 Partial (assigned)
**Issue:** [#6091](https://github.com/Kilo-Org/kilocode/issues/6091)

## Problem

The old extension had a "MemoryBank" feature where users stored persistent context (project notes, preferences, important information) that was automatically injected into agent sessions. This feature is deprecated in the new extension.

However, users who had MemoryBank content need a migration path. The CLI uses `AGENTS.md` files (and similar rule files) as the equivalent mechanism.

## Remaining Work

- Detect whether the user has MemoryBank content in the old extension's storage
- On first activation (or on user request), offer to migrate MemoryBank content:
  - Read the existing MemoryBank content
  - Offer to write it to `AGENTS.md` in the workspace root (or `~/.kilocode/rules/` for global rules)
  - Show the content to the user for review before writing — do not silently overwrite existing `AGENTS.md`
  - If `AGENTS.md` already exists, offer to append the MemoryBank content at the end with a clear delimiter
- Show documentation or a tooltip explaining that the equivalent of MemoryBank in the new extension is `AGENTS.md` / rules files

## Implementation Notes

- MemoryBank was stored per-workspace in VS Code's `workspaceState` under the old extension
- The user should always review and approve before the content is written to their filesystem
- The migration UI can be a simple modal or a confirmation notification with a "Review and Import" button
