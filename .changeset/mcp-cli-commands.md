---
"@kilocode/cli": minor
---

Add MCP CLI commands for managing MCP servers without VSCode.

Implemented `mcp` command with subcommands:

- `list` - List all configured MCP servers
- `add` - Add a new MCP server configuration
- `remove` - Remove an MCP server configuration
- `edit` - Edit an existing MCP server configuration
- `enable` - Enable a specific MCP server
- `disable` - Disable a specific MCP server

The commands work independently of VSCode, allowing users to manage MCP server configurations via the CLI.
