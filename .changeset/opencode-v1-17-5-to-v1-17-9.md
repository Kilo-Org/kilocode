---
"@kilocode/cli": patch
"kilo-code": patch
---

Changes from opencode v1.17.5 to v1.17.9 upstream:

- Core Bugfixes: Improved MCP server compatibility by declaring Kilo's supported client capabilities.
- Core Bugfixes: Plugin client requests now reuse the active server instead of assuming the default local port.
- Core Bugfixes: ACP shell tool calls now show the command and working directory from the start.
- Core Bugfixes: Plugin-provided shell environment variables now apply to PTY sessions.
- Core Bugfixes: OpenAI-compatible providers now accept MCP tool schemas that previously failed validation. (@jquense)
- Core Bugfixes: Cloudflare AI Gateway now receives the configured API key correctly. (@keefetang)
- Core Bugfixes: MCP tools without declared schema properties now work with providers that expect object properties.
- Core Bugfixes: Long-running MCP tools now keep their timeout alive when they report progress. (@Nomadcxx)
- Core Bugfixes: The MCP OAuth callback server now shuts down once authorization finishes or is cancelled.
- Core Bugfixes: MCP tool failures now surface the server's error text instead of a generic failure.
- Core Bugfixes: MCP OAuth error pages now escape provider error text correctly.
- Core Bugfixes: Honor configured agent step limits by forcing a final text response instead of failing mid-run.
- Core Bugfixes: Fix Devstral model detection when provider IDs use different casing. (@Robin1987China)
- Core Bugfixes: Pass configured custom headers to Copilot model requests.
- Core Improvements: MCP servers can now receive the current workspace as a client root.
- Core Improvements: Session timelines load much faster and avoid flicker or scroll jumps.
- Core Improvements: Add `high` and `max` thinking variants for GLM-5.2 across supported providers. (@imranshaiedi-byte)
- Core Improvements: Stop wrapping follow-up user messages in a steering reminder so prompt caching stays effective.
- TUI Bugfixes: MCP debug now uses the SDK's latest protocol version.
- TUI Bugfixes: Only show the background subagent shortcut when the server supports it.
