---
"@kilocode/cli": patch
---

Refresh an expired MCP OAuth token automatically. Servers that reject an expired access token with `403` (rather than `401`) no longer leave the connection stuck on "authentication required", so a new worktree or project session reconnects without asking you to sign in again.
