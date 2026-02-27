# Approval Box Missing Full Path for Out-of-Workspace Requests

**Priority:** P1
**Status:** 🔨 Partial (assigned)
**Issue:** [#6092](https://github.com/Kilo-Org/kilocode/issues/6092)

## Problem

When the CLI requests permission to read or list a path outside the current workspace, the approval dialog only shows the relative directory name — not the full absolute path. This makes it impossible for the user to verify what is actually being accessed before approving.

For example, if the agent tries to list `/home/user/.config/someapp/`, the approval box might show only `someapp/` instead of the full path.

## Remaining Work

- In the permission/approval rendering component, always display the full absolute path for file system operations
- When the path is inside the workspace, a relative path is acceptable (and may be preferred for readability), but append a visual indicator if it is _outside_ the workspace (e.g., "⚠ outside workspace")
- For paths outside the workspace, never truncate — show the complete absolute path
- Consider truncating only the beginning of very long paths with an ellipsis, ensuring the trailing file/dir name is always visible

## Implementation Notes

- Permission prompts are rendered by kilo-ui's permission prompt component; the path data comes from the CLI's tool call
- This is a webview-side rendering change — the path value itself is already available in the message data
