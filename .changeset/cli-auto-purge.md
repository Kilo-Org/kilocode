---
"@kilocode/cli": minor
---

Add auto-purge feature for CLI task history management

- Added `autoPurge` configuration option to CLI config schema
- Implemented `AutoPurgeService` to automatically clean up old tasks based on retention settings
- Supports configurable retention periods for completed, incomplete, and favorited tasks
- Favorited tasks can be preserved indefinitely by setting retention to null
- Updated disk space management documentation with safer cleanup commands that preserve user config
- Added comprehensive safety measures including path traversal protection and timestamp validation
