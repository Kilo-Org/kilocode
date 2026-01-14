---
"kilo-code": minor
---

Add Cloud run mode to Agent Manager for starting cloud agent sessions

The Agent Manager dropdown now includes a "Cloud" option alongside "Local" and "Worktree". When Cloud mode is selected, sessions are started using the Kilo Code Cloud Agent V2 API instead of spawning a local CLI process.

Key features:

- Cloud Agent V2 API integration (prepare, initiate, sendMessage)
- Login redirect when user has no kilocodeToken configured
- WebSocket stream URL generation for real-time updates (streaming to be added in follow-up)
