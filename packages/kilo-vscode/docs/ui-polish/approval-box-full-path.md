# Approval Box Missing Full Path for Out-of-Workspace Requests

**Priority:** P1
**Issue:** [#6092](https://github.com/Kilo-Org/kilocode/issues/6092)

Permission prompt shows whatever CLI sends — no explicit full path display logic.

## Remaining Work

- Always display the full absolute path for file system operations in the permission/approval rendering
- For paths inside the workspace, relative path is acceptable but append a visual indicator if outside the workspace
- For paths outside the workspace, never truncate — show the complete absolute path
- Consider truncating only the beginning of very long paths with an ellipsis
