# Policy Watcher Patches

This directory contains patches for `@vscode/policy-watcher` package.

## macos-optional-fix.patch

**Issue**: macOS compilation fails with `std::optional` errors because the `<optional>` header is not included in `PreferencesPolicy.hh`.

**Fix**: Added `#include <optional>` to `src/macos/PreferencesPolicy.hh` after the CoreFoundation include.

**Application**: The patch is automatically applied via `scripts/apply-policy-watcher-patch.js` during `copy:resource-nodemodules` in `jetbrains/plugin/package.json`.

**Note**: This follows the same pattern as `deps/patches/vscode/jetbrains.patch` for consistency.
