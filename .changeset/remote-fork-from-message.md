---
"@kilocode/cli": minor
---

Let the mobile app fork a session from a specific message onto a remote CLI: `create_session` accepts `cloneUpToMessageId`, imports only the transcript up to that message, and restores only the file edits made before it.
