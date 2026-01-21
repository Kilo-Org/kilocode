---
"kilo-code": minor
---

Agent Manager: Add YOLO mode toggle and session rename features

**New Features:**

- Add YOLO mode toggle button in session header to enable/disable auto-approval of operations
- Add YOLO mode indicator (⚡) in session list for sessions running in YOLO mode
- Add inline session rename functionality - click on session title to edit

**Bug Fixes:**

- Fix messages not loading when reopening Agent Manager panel (pre-existing bug)
- Fix race condition where pending session timeout could fire after provisional session was already created

**Improvements:**

- Add TypeScript types for `respondToApproval` message
- Add translations for YOLO mode and rename features in all 21 supported locales
