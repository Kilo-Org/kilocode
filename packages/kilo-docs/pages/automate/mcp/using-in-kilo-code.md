---
title: "Using MCP in Kilo Code"
description: "How to use MCP servers in Kilo Code"
---

# Using MCP in Kilo Code

Model Context Protocol (MCP) extends Kilo Code's capabilities by connecting to external tools and services. This guide covers everything you need to know about using MCP with Kilo Code.

## Configuring MCP Servers

{% tabs %}
{% tab label="VSCode" %}

MCP server configurations are stored inside the main Kilo config file. There are two levels:

1. **Global Configuration**: `~/.config/kilo/kilo.jsonc` (preferred) or `~/.config/kilo/kilo.json` applies to all projects.
2. **Project-level Configuration**: `kilo.jsonc` or `kilo.json` in your project root, or the matching file in `.kilo/` for a cleaner setup.

**Precedence**: Project-level configuration takes precedence over global configuration. At one location, Kilo loads `kilo.json` before `kilo.jsonc`, so JSONC takes precedence.

### Editing MCP Settings

You can edit MCP settings from the Kilo Code settings UI:

1. Click the {% codicon name="gear" /%} icon in the sidebar toolbar to open Settings.
2. Click the `Agent Behaviour` tab on the left side.
3. Select the `MCP Servers` sub-tab.

From here you can add, edit, enable/disable, and delete MCP servers. Changes are written directly to the appropriate config file.

If the UI cannot add a server, edit a Kilo config file directly and add the server under the top-level `mcp` key. For project-specific servers, edit `./kilo.json` or `./kilo.jsonc` if your project already has one; otherwise use `./.kilo/kilo.json` or `./.kilo/kilo.jsonc` for a cleaner setup. For servers you want in every workspace, use `~/.config/kilo/kilo.json` or `~/.config/kilo/kilo.jsonc`.

### Config Format

MCP servers are configured under the `mcp` key in `kilo.jsonc`:

**Local (STDIO) server:**

```json
{
  "mcp": {
    "my-local-server": {
      "type": "local",
      "command": ["node", "/path/to/server.js"],
      "environment": {
        "API_KEY": "your_api_key"
      },
      "enabled": true,
      "timeout": 10000
    }
  }
}
```

**Remote (HTTP/SSE) server:**

```json
{
  "mcp": {
    "my-remote-server": {
      "type": "remote",
      "url": "https://your-server-url.com/mcp",
      "headers": {
        "Authorization": "Bearer your-token"
      },
      "enabled": true,
      "timeout": 15000
    }
  }
}
```

Remote servers support OAuth 2.0 authentication. If the server supports it, Kilo Code will automatically start the OAuth flow when you connect. You can also disable OAuth with `"oauth": false`.

{% /tab %}
{% tab label="CLI" %}

Kilo automatically discovers only its canonical main configuration files:

| Scope | Path |
|---|---|
| **Global** | `~/.config/kilo/kilo.jsonc` (preferred) or `~/.config/kilo/kilo.json` |
| **Project** | `./kilo.jsonc` or `./kilo.json`, or the matching file in `./.kilo/` |

When both files exist in the same location, `kilo.jsonc` takes precedence. Automatically discovered `opencode.json`, `opencode.jsonc`, `.opencode` directories, global legacy `config.json`, and the legacy TOML `config` file are ignored. Rename OpenCode files to `kilo.json` or `kilo.jsonc`, and move them to one of the locations above. Copy settings from the legacy TOML file into a Kilo JSON or JSONC file.

`KILO_CONFIG` is an explicit opt-in that loads exactly the file path you provide, regardless of its filename. `KILO_CONFIG_DIR` can name any directory, but Kilo automatically loads only `kilo.json` and `kilo.jsonc` inside it.

{% /tab %}
{% /tabs %}

## Configuration Format

{% tabs %}
{% tab label="VSCode" %}

In the VS Code extension, open **Settings → MCP** and click **Add Server** to configure a new server through the UI. You can also edit the config files directly — see the **CLI** tab for the JSON format.

{% /tab %}
{% tab label="CLI" %}

Add MCP servers under the `mcp` key in your config file. Each server has a unique name that you can reference in prompts.

```json
{
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["npx", "-y", "my-mcp-command"],
      "enabled": true
    }
  }
}
```

You can disable a server by setting `enabled` to `false` without removing it from your config.

{% /tab %}
{% /tabs %}

## Understanding Transport Types

MCP supports two main transport types:

- **Local (STDIO)**: Servers run as a child process on your machine, communicating over stdin/stdout.
- **Remote (HTTP/SSE)**: Servers hosted over HTTP/HTTPS. Kilo Code tries `StreamableHTTP` first, then falls back to `SSE` automatically.

For more details, see [STDIO & SSE Transports](server-transports).

### STDIO Transport

Used for local servers running on your machine:

- Communicates via standard input/output streams
- Lower latency (no network overhead)
- Better security (no network exposure)
- Simpler setup (no HTTP server needed)
- Runs as a child process on your machine

For more in-depth information about how STDIO transport works, see [STDIO Transport](server-transports#stdio-transport).

STDIO configuration example:

{% tabs %}
{% tab label="VSCode" %}

In the VS Code extension, open **Settings → MCP**, click **Add Server**, and choose **Local (stdio)**. Fill in the command, arguments, and optional environment variables through the UI. You can also edit the config files directly — see the **CLI** tab for the JSON format.

{% /tab %}
{% tab label="CLI" %}

```json
{
  "mcp": {
    "my-local-server": {
      "type": "local",
      "command": ["npx", "-y", "my-mcp-command"],
      "enabled": true,
      "environment": {
        "API_KEY": "your_api_key"
      }
    }
  }
}
```

#### Local Server Options

| Option | Type | Required | Description |
|---|---|---|---|
| `type` | String | Yes | Must be `"local"`. |
| `command` | Array | Yes | Command and arguments to run the MCP server. |
| `environment` | Object | No | Environment variables to set when running the server. |
| `enabled` | Boolean | No | Enable or disable the MCP server on startup. |
| `timeout` | Number | No | Timeout in ms for fetching tools from the MCP server. Default: 30000. |

{% /tab %}
{% /tabs %}

### Streamable HTTP Transport

Used for remote servers accessed over HTTP/HTTPS:

- Can be hosted on a different machine
- Supports multiple client connections
- Requires network access
- Allows centralized deployment and management

{% tabs %}
{% tab label="VSCode" %}

In the VS Code extension, open **Settings → MCP**, click **Add Server**, and choose **Remote (HTTP)**. Enter the server URL and optional headers through the UI. You can also edit the config files directly — see the **CLI** tab for the JSON format.

{% /tab %}
{% tab label="CLI" %}

```json
{
  "mcp": {
    "my-remote-server": {
      "type": "remote",
      "url": "https://my-mcp-server.com/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer MY_API_KEY"
      }
    }
  }
}
```

#### Remote Server Options

| Option | Type | Required | Description |
|---|---|---|---|
| `type` | String | Yes | Must be `"remote"`. |
| `url` | String | Yes | URL of the remote MCP server. |
| `enabled` | Boolean | No | Enable or disable the MCP server on startup. |
| `headers` | Object | No | HTTP headers to send with requests. |
| `timeout` | Number | No | Timeout in ms for fetching tools from the MCP server. Default: 30000. |

{% /tab %}
{% /tabs %}

### SSE Transport

    ⚠️ DEPRECATED: The SSE Transport has been deprecated as of MCP specification version 2025-03-26. Please use the HTTP Stream Transport instead, which implements the new Streamable HTTP transport specification.

Used for remote servers accessed over HTTP/HTTPS:

- Communicates via Server-Sent Events protocol
- Can be hosted on a different machine
- Supports multiple client connections
- Requires network access
- Allows centralized deployment and management

For more in-depth information about how SSE transport works, see [SSE Transport](server-transports#sse-transport).

SSE configuration example:

```json
{
  "mcpServers": {
    "remote-server": {
      "url": "https://your-server-url.com/mcp",
      "headers": {
        "Authorization": "Bearer your-token"
      },
      "alwaysAllow": ["tool3"],
      "disabled": false
    }
  }
}
```

## Managing MCP Servers

{% tabs %}
{% tab label="VSCode" %}

In the VS Code extension, manage MCP servers from **Settings → MCP**:

- **Add a server**: Click **Add Server** and fill in the details
- **Enable/disable**: Toggle a server on or off without removing its configuration
- **Delete**: Remove a server from the list

The extension also supports the `{env:VARIABLE_NAME}` syntax in config files to reference environment variables (see the **CLI** tab for details).

{% /tab %}
{% tab label="CLI" %}

### CLI Commands

| Command | Description |
|---|---|
| `kilo mcp list` | List all configured MCP servers |
| `kilo mcp add` | Add an MCP server |
| `kilo mcp auth` | Authenticate with an MCP server |
| `kilo mcp logout` | Log out from an MCP server |
| `kilo mcp debug` | Debug an MCP server connection |

### Enabling or Disabling a Server

Inside the interactive TUI, use the `/mcps` slash command to toggle MCP servers on or off.

You can also edit your config directly. Set `enabled` to `false` to disable a server without deleting it, or `true` to enable it again:

```json
{
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["npx", "-y", "my-mcp-command"],
      "enabled": false
    }
  }
}
```

Run `kilo mcp list` to verify the server status.

### Environment Variables

Use `{env:VARIABLE_NAME}` syntax in config files to reference environment variables:

```json
{
  "mcp": {
    "my-server": {
      "type": "remote",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer {env:MY_API_KEY}"
      }
    }
  }
}
```

{% /tab %}
{% /tabs %}

### Network Timeout

{% tabs %}
{% tab label="VSCode" %}

Set the `timeout` field (in milliseconds) in the server's config entry. The default is 10 seconds for local servers and 15 seconds for remote servers.

{% /tab %}
{% tab label="CLI" %}

Set the `timeout` field (in milliseconds) in the server's config entry. The default is 30000 (30 seconds).

{% /tab %}
{% /tabs %}

### Auto Approve Tools

{% tabs %}
{% tab label="VSCode" %}

MCP tool calls use the same permission system as built-in tools. Each MCP tool's permission key is its namespaced name: `{server}_{tool}` (e.g. `my_server_do_something`).

**At runtime:** When an MCP tool is called, the Permission Dock shows an approval prompt. Click **Approve Always** to save an allow rule to your config so future calls to that tool are auto-approved.

**In your config file:** Add the tool name (or a wildcard pattern) to the `permission` key in `kilo.jsonc`:

```json
{
  "permission": {
    "my_server_do_something": "allow",
    "my_server_*": "allow"
  }
}
```

{% /tab %}
{% tab label="CLI" %}

Add `permission` entries to your config to auto-approve specific tools. MCP tool keys use the server name, an underscore, then the tool name:

```json
{
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["npx", "-y", "my-mcp-server"],
      "enabled": true
    }
  },
  "permission": {
    "my-server_tool1": "allow",
    "my-server_tool2": "allow"
  }
}
```

{% /tab %}
{% /tabs %}

## Platform-Specific Local Server Commands

Local MCP server instructions are often written as shell commands, such as `npx -y @modelcontextprotocol/server-puppeteer`. Use the right command format for your operating system.

{% tabs %}
{% tab label="VSCode" %}

In the VS Code extension, open **Settings → MCP**, click **Add Server**, and choose **Local (stdio)**.

### Windows

Use `cmd` as the command and pass the package command as arguments:

| Field | Value |
|---|---|
| **Name** | `puppeteer` |
| **Command** | `cmd` |
| **Arguments** | `/c`, `npx`, `-y`, `@modelcontextprotocol/server-puppeteer` |

### macOS and Linux

Use the executable directly:

| Field | Value |
|---|---|
| **Name** | `puppeteer` |
| **Command** | `npx` |
| **Arguments** | `-y`, `@modelcontextprotocol/server-puppeteer` |

{% /tab %}
{% tab label="CLI" %}

### Windows

Use the full `cmd` invocation in the `command` array:

```json
{
  "mcp": {
    "puppeteer": {
      "type": "local",
      "command": ["cmd", "/c", "npx", "-y", "@modelcontextprotocol/server-puppeteer"],
      "enabled": true
    }
  }
}
```

### macOS and Linux

Use `npx` directly:

```json
{
  "mcp": {
    "puppeteer": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-puppeteer"],
      "enabled": true
    }
  }
}
```

{% /tab %}
{% /tabs %}

## MCP Server Examples

These examples use the current `mcp` config format. In VS Code, use **Settings → MCP → Add Server** and enter the same type, URL, or command values through the UI.

### Figma Desktop

Connect to the Figma Desktop app's MCP server:

```json
{
  "mcp": {
    "Figma Desktop": {
      "type": "remote",
      "url": "http://127.0.0.1:3845/mcp"
    }
  }
}
```

### Context7

Add the [Context7](https://github.com/upstash/context7) MCP server for documentation search:

```json
{
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```

### Everything Test Server

Add the test MCP server for development:

```json
{
  "mcp": {
    "mcp_everything": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-everything"]
    }
  }
}
```

## Finding and Installing MCP Servers

Kilo Code does not come with any pre-installed MCP servers. You'll need to find and install them separately.

- **Kilo Marketplace:** Browse community-contributed MCP server configurations and agent skills in the [Kilo Marketplace](https://github.com/Kilo-Org/kilo-marketplace). The marketplace includes ready-to-use configs for popular tools like Figma, Sentry, and more.
- **Community Repositories:** Check for community-maintained lists of MCP servers on GitHub
- **Ask Kilo Code:** You can ask Kilo Code to help you find or even create MCP servers
- **Build Your Own:** Create custom MCP servers using the SDK to extend Kilo Code with your own tools

For full SDK documentation, visit the [MCP GitHub repository](https://github.com/modelcontextprotocol/).

## Using MCP Tools in Your Workflow

After configuring an MCP server, Kilo Code will automatically detect available tools and resources. To use them:

1. Type your request in the Kilo Code chat interface
2. Kilo Code will identify when an MCP tool can help with your task
3. Approve the tool use when prompted (or use auto-approval)

Example: "Analyze the performance of my API" might use an MCP tool that tests API endpoints.

## Troubleshooting MCP Servers

{% tabs %}
{% tab label="VSCode" %}

- **Server Not Responding:** Check if the server process is running and verify network connectivity. Review server status in Settings > Agent Behaviour > MCP Servers.
- **`needs_auth` status:** For remote servers with OAuth, the extension will show a notification to start the auth flow. Click it to authenticate.
- **`failed` status:** Check the CLI output for error details. Ensure commands and paths are correct.
- **Tool Not Available:** Confirm the server is properly implementing the tool and it's not disabled in settings.

{% /tab %}
{% tab label="CLI" %}

- **Server Not Responding:** Check if the server process is running. Use `kilo mcp debug <server-name>` to inspect the connection.
- **Permission Errors:** Ensure API keys and credentials are set in your `kilo.jsonc` config or via `{env:VARIABLE_NAME}` references.
- **Tool Not Available:** Confirm the server is properly implementing the tool and it is not disabled (`"enabled": false`) in your config.
- **Slow Performance:** Increase the `timeout` value for the specific MCP server in your config.

{% /tab %}
{% /tabs %}

{% callout type="tip" %}
**Reduce system prompt size:** If you're not using MCP, turn it off in Settings > Agent Behaviour > MCP Servers to significantly cut down the size of the system prompt and improve performance.
{% /callout %}
