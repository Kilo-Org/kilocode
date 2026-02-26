# MCP (Model Context Protocol) & MCP Hub

**Priority:** P1
**Status:** 🔨 Partial

## What Exists

- HTTP client methods: `getMcpStatus()`, `addMcpServer()`, `connectMcpServer()`, `disconnectMcpServer()`
- `BrowserAutomationService` uses MCP API to register Playwright MCP server
- AgentBehaviour settings tab has "MCP Servers" subtab showing a **read-only list** of configured MCP servers (names, commands/args, URLs)

## Remaining Work

- Add/edit/delete MCP server controls in the settings UI
- Connect/disconnect controls per server
- Tool allowlisting/disablement per server
- Connection status display per server (connected/disconnected/error)
- Auto-reconnect and error history display
- MCP Hub for discovering available MCP servers
