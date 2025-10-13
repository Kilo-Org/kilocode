# CI Git Directory Renaming Fix Analysis and Solution

## Problem Analysis

The CI failure was caused by the transition from Git submodules to a different approach for managing the VSCode dependency. The [`check-dependencies.js`](jetbrains/scripts/check-dependencies.js) script uses a pattern of renaming the `.git` directory to `.git.disabled` to prevent the VSCode directory from showing up in Git changes.

### Root Cause

1. **Git Directory Renaming**: The script renames `.git` to `.git.disabled` after setup to disable Git tracking
2. **CI Environment**: In CI, the `.git.disabled` file may already exist from previous runs or caching
3. **Script Logic**: The script didn't handle the case where `.git.disabled` exists and needs to be renamed back to `.git` for Git operations

### The Actual Pattern (Not Worktrees)

The approach is much simpler than worktrees:

1. Clone VSCode repository normally
2. Apply JetBrains patches using Git
3. **Rename `.git` to `.git.disabled`** to hide the directory from Git tracking
4. This prevents VSCode files from appearing in `git status` and diffs

### Previous Issue

When the script ran in CI:

- `.git.disabled` already existed (from previous runs or caching)
- Script tried to do Git operations but `.git` directory didn't exist
- Git commands failed because the repository wasn't accessible

## Solution Implemented

Modified the [`checkVscodeDirectory()`](jetbrains/scripts/check-dependencies.js:298) function to:

1. **Check for Disabled Git**: Detect if `.git.disabled` exists but `.git` doesn't
2. **Temporarily Re-enable**: Rename `.git.disabled` back to `.git` for operations
3. **Perform Git Operations**: Apply patches and do necessary Git work
4. **Re-disable Git**: Always rename `.git` back to `.git.disabled` at the end

### Key Changes

```javascript
// Check if git tracking was previously disabled and needs to be re-enabled for operations
let gitWasDisabled = false
if (!fs.existsSync(gitFile) && fs.existsSync(gitDisabledFile)) {
	printStatus("Re-enabling git tracking for operations...")
	fs.renameSync(gitDisabledFile, gitFile)
	gitWasDisabled = true
	printFix("Re-enabled git tracking temporarily")
}

// ... perform git operations ...

// Always disable git tracking at the end
if (fs.existsSync(gitFile) && !fs.existsSync(gitDisabledFile)) {
	fs.renameSync(gitFile, gitDisabledFile)
	printFix("Disabled git tracking for VSCode directory")
} else if (gitWasDisabled && fs.existsSync(gitFile)) {
	fs.renameSync(gitFile, gitDisabledFile)
	printFix("Re-disabled git tracking for VSCode directory")
}
```

## Benefits

1. **Simple and Robust**: No complex worktree logic needed
2. **CI Compatible**: Handles cached `.git.disabled` files correctly
3. **Maintains Goal**: VSCode directory still doesn't appear in Git changes
4. **Backward Compatible**: Works with fresh clones and existing setups

## Testing

The fix has been tested locally and successfully:

- Handles existing `.git.disabled` files correctly
- Temporarily re-enables Git for patch operations
- Always disables Git tracking at the end
- Completes all dependency checks successfully

This should resolve the CI failure by properly handling the Git directory renaming pattern used to hide the VSCode dependency from Git tracking.
