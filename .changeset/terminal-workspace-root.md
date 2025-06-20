---
"kilo-code": minor
---

Add $WORKSPACE_ROOT environment variable to terminal sessions for easier workspace navigation

Terminal sessions now automatically include a `$WORKSPACE_ROOT` environment variable that points to your current workspace root directory. This makes it easier for the agent to run terminal commands in sub-directories, for example, running just one directory's tests: `cd $WORKSPACE_ROOT && npx jest`.

This enhancement is particularly useful when working in deeply nested directories or when you need to quickly reference files or tests at the root level. In multi-workspace setups, this points to the workspace folder containing your currently active file.
