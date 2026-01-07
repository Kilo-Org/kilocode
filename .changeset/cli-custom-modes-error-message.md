---
"@kilocode/cli": patch
---

fix(cli): improve error message for custom mode not found

- Changed error from "Invalid mode" to "Mode not found" with search path details
- Added `SearchedPath` interface and `getSearchedPaths()` export for error reporting
- Added debug logging to help diagnose custom modes loading issues
- Shows exactly where CLI searched for custom modes (global and project paths)

Fixes #4575, fixes #4600
