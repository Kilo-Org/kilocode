# Show Changelog on Extension Update

**Priority:** P3
**Issue:** [#6079](https://github.com/Kilo-Org/kilocode/issues/6079)

No version comparison or "What's New" notification exists.

## Remaining Work

- On activation, compare current version against last-seen version in `globalState`
- If version changed, show notification with "What's New" and "Dismiss" options
- Update stored version after showing
- Do not show on first install
