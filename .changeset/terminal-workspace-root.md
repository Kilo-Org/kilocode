---
"kilo-code": minor
---

Add $WORKSPACE_ROOT environment variable to terminal sessions for easier workspace navigation

Terminal sessions now automatically include a `$WORKSPACE_ROOT` environment variable that points to your current workspace root directory. In multi-workspace setups, this points to the workspace folder containing your currently active file. This makes it easier to navigate back to your project root from anywhere in the terminal using commands like `cd $WORKSPACE_ROOT` or referencing files relative to your workspace.

This enhancement is particularly useful when working in deeply nested directories or when you need to quickly reference files or tests at the root level.
