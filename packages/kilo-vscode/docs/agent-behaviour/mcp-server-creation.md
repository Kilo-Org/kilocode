# MCP Servers Sub-Tab Parity

**Priority:** P2

The legacy MCP Servers sub-tab (842 lines) had full server lifecycle management. The new sub-tab supports viewing, removing, and toggling servers with live connection status.

## Side-by-Side Comparison

| Feature | Legacy | New |
|---|---|---|
| View server list | Name + source badge + status dot | Name + command/URL |
| Add server | Via edit config file buttons | Not available |
| Remove server | Delete button + confirmation | Remove button + confirmation |
| Edit server config | Via edit config file buttons | Not available |
| Connection status | Colored dot (green/yellow/red) | Live status display |
| Enable/disable toggle | `ToggleSwitch` per server | Connect/disconnect toggle |
| Restart/refresh | Per-server refresh button | Not available |
| Refresh all | "Refresh All MCP Servers" button | Not available |
| Edit Global MCP config | Button to open file | Not available |
| Edit Project MCP config | Button to open file | Not available |
| Network timeout | Per-server dropdown (15s–60min) | Not available |
| Server source badge | Shows "global" / "project" | Not displayed |
| Empty state | N/A | "No MCP servers configured. Edit the opencode config file..." |

### Expandable Server Detail (Legacy Only)

When a server was connected and enabled, expanding it showed 5 tabs:

| Tab | Content |
|---|---|
| Tools | List of MCP tools with tool count |
| Resources | List of resources + resource templates with count |
| Instructions | Server-provided instruction text (if present) |
| Logs | Error/log entries sorted by timestamp with count |
| Auth | OAuth debug info: auth status, token expiration, scopes, refresh info |

The new extension has none of this expandable detail.

## Remaining Work

### Important (P2)

- **Add MCP Server dialog**: Form to define a new server with name, transport type (stdio/SSE), command+args or URL, environment variables. Write to CLI config via `updateConfig()`
- **Edit MCP Server**: Allow modifying existing server configurations
- **Restart/refresh button**: Per-server and "refresh all" buttons. Requires CLI endpoint to restart MCP servers
- **Edit config file buttons**: Quick links to open global/project MCP config in the editor

### Nice to Have (P3)

- **Expandable server detail**: Show tools, resources, instructions, and logs per server when expanded. Requires CLI to expose per-server tool/resource/log data
- **Network timeout per server**: If CLI supports per-server timeout config, expose it
- **Server source badge**: Display whether server comes from global or project config
- **OAuth/Auth tab**: Display auth status for OAuth-based MCP servers (depends on CLI support)

## Notes

The mcp-and-mcp-hub.md doc in `non-agent-features/` tracks MCP configuration as a broader feature. This doc focuses specifically on the MCP Servers sub-tab within the Agent Behaviour settings tab. The Marketplace covers MCP server discovery and installation from a registry.
