---
"kilo-code": patch
---

Fix Agent Manager project accordions that stayed on a loading indicator until you clicked into them. Expanded projects other than the active one now receive their worktrees, sessions, and git stats as soon as Agent Manager opens and again after the panel reloads. While a project is still loading, its local row and section headings stay in place and the rows below fade in as skeleton placeholders instead of showing a single centered spinner, so several projects loading at once look consistent.
