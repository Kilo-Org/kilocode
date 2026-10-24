---
"@kilocode/cli": patch
---

Update the MCP TypeScript SDK to 1.32.1 to fix security issues flagged by Dependabot, including MCP HTTP and OAuth requests following cross-origin redirects. Remote MCP servers whose URL redirects to another origin, or answers `POST` with a `301`, `302` or `303` redirect, no longer connect; use the server's final URL instead.
