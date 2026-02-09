---
"kilo-code": minor
---

feat(agent-manager): add YOLO mode toggle and session rename

**New Features:**

- Add YOLO mode toggle button in new agent form to enable/disable auto-approval of tools
- Add YOLO mode indicator (⚡) in session header and sidebar for sessions running in YOLO mode
- Add inline session rename - click on session title to edit

**Technical Details:**

- `yoloMode` maps to `autoApprove` config in agent-runtime
- Added translations for all 22 supported locales
