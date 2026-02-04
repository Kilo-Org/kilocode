---
title: "Using MCP in CLI"
description: "How to use MCP servers in the CLI"
---

# Using MCP in the CLI

The Kilo Code CLI supports MCP servers, but uses a **different configuration path** than the VS Code extension.

## Configuration Location

| Environment | MCP Settings Path                                   |
| ----------- | --------------------------------------------------- |
| **CLI**     | `~/.kilocode/cli/global/settings/mcp_settings.json` |
| **VS Code** | VS Code's global storage directory                  |

MCP servers configured in VS Code are **not** automatically available in the CLI. You must configure them separately.

## Configuration Format

Edit `~/.kilocode/cli/global/settings/mcp_settings.json`:

```json
{
	"mcpServers": {
		"server-name": {
			"command": "node",
			"args": ["/path/to/server.js"],
			"env": {
				"API_KEY": "your_api_key"
			},
			"alwaysAllow": ["tool1", "tool2"],
			"disabled": false
		}
	}
}
```

## Transport Types

### STDIO (Local Servers)

```json
{
	"mcpServers": {
		"local-server": {
			"command": "node",
			"args": ["/path/to/server.js"],
			"env": {}
		}
	}
}
```

### Streamable HTTP (Remote Servers)

```json
{
	"mcpServers": {
		"remote-server": {
			"type": "streamable-http",
			"url": "https://your-server.com/mcp",
			"headers": {
				"Authorization": "Bearer token"
			}
		}
	}
}
```

## Project-Level Configuration

You can define MCP servers per-project by creating `.kilocode/mcp.json` in your project root. Project-level servers take precedence over global settings.

## Configuration Options

| Option        | Description                                                 |
| ------------- | ----------------------------------------------------------- |
| `command`     | Executable to run (STDIO)                                   |
| `args`        | Command arguments (STDIO)                                   |
| `env`         | Environment variables                                       |
| `type`        | Transport type: `stdio` (default), `streamable-http`, `sse` |
| `url`         | Server URL (HTTP transports)                                |
| `headers`     | HTTP headers (HTTP transports)                              |
| `alwaysAllow` | Array of tool names to auto-approve                         |
| `disabled`    | Set `true` to disable without removing                      |
| `timeout`     | Request timeout in seconds (default: 60)                    |

## Auto-Approval

MCP auto-approval is controlled via CLI config (`kilocode config`):

```json
{
	"autoApproval": {
		"mcp": {
			"enabled": true
		}
	}
}
```

Or via environment variable:

```bash
export KILO_AUTO_APPROVAL_MCP_ENABLED=true
```

Per-tool auto-approval uses the `alwaysAllow` array in the server configuration.
