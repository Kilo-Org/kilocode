---
"@kilocode/cli": patch
---

Fix `kilo mcp auth` failing at the last step when another Kilo process touches the same MCP server while the browser tab is open: the OAuth flow now keeps its own state and PKCE verifier instead of reading them back from the process-shared `mcp-auth.json`, and every remaining failure names the step that failed (the token exchange, the browser authorization, a timeout, or a superseded authorization attempt). Running `kilo mcp auth` for the same server at the same time in two terminals now works too: the newer attempt takes the local callback listener over, the later browser tab completes, and the earlier command reports that it was replaced.
