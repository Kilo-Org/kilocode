---
"kilo-code": patch
---

fix: prevent false unsaved changes dialogs in settings

Fixed a bug where the "unsaved changes" dialog would appear even when no user changes had been made. The issue was that setCachedStateField would always set isChangeDetected to true, even for internal/programmatic updates during component initialization.

Now setCachedStateField accepts an optional `isInternal` parameter to distinguish between user actions (which should trigger change detection) and internal updates (which should not).
