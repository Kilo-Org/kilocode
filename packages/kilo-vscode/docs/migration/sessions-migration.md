# Session Migration from Old Extension

**Priority:** P3
**Status:** ❌ Not started
**Issue:** [#6090](https://github.com/Kilo-Org/kilocode/issues/6090)

## Problem

Users upgrading from the old extension lose all their chat session history. The old extension stored sessions in VS Code's `globalState`. The new extension stores sessions in the CLI's session directory (`~/.local/share/opencode/sessions/` or equivalent). The formats are incompatible.

## Remaining Work

- Investigate: what format does the old extension use for sessions (JSON in globalState, files on disk, etc.)?
- Investigate: what format does the CLI use for sessions?
- Determine if the old session format can be converted to the new format with reasonable fidelity
- If conversion is feasible:
  - On first activation (or on explicit user request), offer to import old sessions
  - Convert old sessions to CLI session format and write them to the CLI sessions directory
  - Show a count of sessions imported / sessions that could not be converted
- If conversion is not feasible (too complex or lossy): at minimum, show the user a notice that their old sessions are not accessible and explain where the old data still lives

## Implementation Notes

- This is low-priority because session history import is a "nice to have" — users can still access their old session data by temporarily reinstalling the old extension
- The old extension's session format should be reverse-engineered from `kilocode-legacy`
