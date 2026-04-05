---
title: "Using MCP in Kilo Code"
description: "How to use MCP servers in Kilo Code"
---

# Using MCP in Kilo Code

Model Context Protocol (MCP) extends Kilo Code's capabilities by connecting to external tools and services. This guide covers everything you need to know about using MCP with Kilo Code.

{% youtube url="https://youtu.be/6O9RQoQRX8A" caption="Demonstrating MCP installation in Kilo Code" /%}

## Configuring MCP Servers

{% tabs %}
{% tab label="VSCode" %}

MCP server configurations are stored inside the main Kilo config file. There are two levels:

1. **Global Configuration**: `~/.config/kilo/kilo.jsonc` — applies to all projects.
2. **Project-level Configuration**: `kilo.jsonc` in your project root, or `.kilo/kilo.jsonc` for a cleaner setup.

**Precedence**: Project-level configuration takes precedence over global configuration.

### Editing MCP Settings

You can edit MCP settings from the Kilo Code settings UI:

1. Click the {% codicon name="gear" /%} icon in the sidebar toolbar to open Settings.
2. Click the `Agent Behaviour` tab on the left side.
3. Select the `MCP Servers` sub-tab.

From here you can add, edit, enable/disable, and delete MCP servers. Changes are written directly to the appropriate config file.

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
{% tab label="VSCode (Legacy)" %}

MCP server configurations can be managed at two levels: **global** (applies across all workspaces) and **project-level** (specific to a single project). Project-level configuration takes precedence over global settings.

| Scope       | Path                 | Description                                                     |
| ----------- | -------------------- | --------------------------------------------------------------- |
| **Global**  | `mcp_settings.json`  | Accessible via VS Code settings. Applies across all workspaces. |
| **Project** | `.kilocode/mcp.json` | In your project root. Auto-detected by Kilo Code.               |

Project-level configs can be committed to version control to share with your team.

{% /tab %}
{% tab label="CLI" %}

The CLI accepts several config filenames. The recommended file is `kilo.json`:

| Scope       | Recommended Path                     | Also supported                                                 |
| ----------- | ------------------------------------ | -------------------------------------------------------------- |
| **Global**  | `~/.config/kilo/kilo.json`           | `kilo.jsonc`, `opencode.json`, `opencode.jsonc`, `config.json` |
| **Project** | `./kilo.json` or `./.kilo/kilo.json` | `kilo.jsonc`, `opencode.jsonc`, `opencode.json`                |

{% /tab %}
{% /tabs %}

## Configuration Format

{% tabs %}
{% tab label="VSCode (Legacy)" %}

Both global and project-level files use a JSON format with a `mcpServers` object containing named server configurations:

```json
{
  "mcpServers": {
    "server1": {
      "command": "python",
      "args": ["/path/to/server.py"],
      "env": {
        "API_KEY": "your_api_key"
      },
      "alwaysAllow": ["tool1", "tool2"],
      "disabled": false
    }
  }
}
```

_Example of MCP Server config in Kilo Code (STDIO Transport)_

{% /tab %}
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
{% tab label="VSCode (Legacy)" %}

```json
{
  "mcpServers": {
    "local-server": {
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

{% /tab %}
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

| Option        | Type    | Required | Description                                                           |
| ------------- | ------- | -------- | --------------------------------------------------------------------- |
| `type`        | String  | Yes      | Must be `"local"`.                                                    |
| `command`     | Array   | Yes      | Command and arguments to run the MCP server.                          |
| `environment` | Object  | No       | Environment variables to set when running the server.                 |
| `enabled`     | Boolean | No       | Enable or disable the MCP server on startup.                          |
| `timeout`     | Number  | No       | Timeout in ms for fetching tools from the MCP server. Default: 30000. |

{% /tab %}
{% /tabs %}

### Streamable HTTP Transport

Used for remote servers accessed over HTTP/HTTPS:

- Can be hosted on a different machine
- Supports multiple client connections
- Requires network access
- Allows centralized deployment and management

{% tabs %}
{% tab label="VSCode (Legacy)" %}

```json
{
  "mcpServers": {
    "remote-server": {
      "type": "streamable-http",
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

{% /tab %}
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

| Option    | Type    | Required | Description                                                           |
| --------- | ------- | -------- | --------------------------------------------------------------------- |
| `type`    | String  | Yes      | Must be `"remote"`.                                                   |
| `url`     | String  | Yes      | URL of the remote MCP server.                                         |
| `enabled` | Boolean | No       | Enable or disable the MCP server on startup.                          |
| `headers` | Object  | No       | HTTP headers to send with requests.                                   |
| `timeout` | Number  | No       | Timeout in ms for fetching tools from the MCP server. Default: 30000. |

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
{% tab label="VSCode (Legacy)" %}

### Editing MCP Settings Files

You can edit both global and project-level MCP configuration files directly from the Kilo Code settings.

1. Click the {% codicon name="gear" /%} icon in the top navigation of the Kilo Code pane to open `Settings`.
2. Click the `Agent Behaviour` tab on the left side
3. Select the `MCP Servers` sub-tab
4. Click the appropriate button:
   - **`Edit Global MCP`**: Opens the global `mcp_settings.json` file.
   - **`Edit Project MCP`**: Opens the project-specific `.kilocode/mcp.json` file. If this file doesn't exist, Kilo Code will create it for you.

{% image src="/docs/img/using-mcp-in-kilo-code/mcp-installed-config.png" alt="Edit Global MCP and Edit Project MCP buttons" width="600" caption="Edit Global MCP and Edit Project MCP buttons" /%}

### Deleting a Server

1. Press the {% codicon name="trash" /%} next to the MCP server you would like to delete
2. Press the `Delete` button on the confirmation box

{% image src="/docs/img/using-mcp-in-kilo-code/using-mcp-in-kilo-code-5.png" alt="Delete confirmation box" width="400" caption="Delete confirmation box" /%}

### Restarting a Server

1. Press the {% codicon name="refresh" /%} button next to the MCP server you would like to restart

### Enabling or Disabling a Server

1. Press the {% codicon name="activate" /%} toggle switch next to the MCP server to enable/disable it

{% /tab %}
{% tab label="VSCode" %}

In the VS Code extension, manage MCP servers from **Settings → MCP**:

- **Add a server**: Click **Add Server** and fill in the details
- **Enable/disable**: Toggle a server on or off without removing its configuration
- **Delete**: Remove a server from the list

The extension also supports the `{env:VARIABLE_NAME}` syntax in config files to reference environment variables (see the **CLI** tab for details).

{% /tab %}
{% tab label="CLI" %}

### CLI Commands

| Command           | Description                     |
| ----------------- | ------------------------------- |
| `kilo mcp list`   | List all configured MCP servers |
| `kilo mcp add`    | Add an MCP server               |
| `kilo mcp auth`   | Authenticate with an MCP server |
| `kilo mcp logout` | Log out from an MCP server      |
| `kilo mcp debug`  | Debug an MCP server connection  |

Inside the interactive TUI, use the `/mcps` slash command to toggle MCP servers on or off.

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
{% tab label="VSCode (Legacy)" %}

To set the maximum time to wait for a response after a tool call to the MCP server:

1. Click the `Network Timeout` pulldown at the bottom of the individual MCP server's config box and change the time. Default is 1 minute but it can be set between 30 seconds and 5 minutes.

{% image src="/docs/img/using-mcp-in-kilo-code/using-mcp-in-kilo-code-6.png" alt="Network Timeout pulldown" width="400" caption="Network Timeout pulldown" /%}

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
{% tab label="VSCode (Legacy)" %}

MCP tool auto-approval works on a per-tool basis and is disabled by default. To configure auto-approval:

1. First enable the global "Use MCP servers" auto-approval option in [auto-approving-actions](/docs/getting-started/settings/auto-approving-actions)
2. Navigate to Settings > Agent Behaviour > MCP Servers, then locate the specific tool you want to auto-approve
3. Check the `Always allow` checkbox next to the tool name

{% image src="/docs/img/using-mcp-in-kilo-code/using-mcp-in-kilo-code-7.png" alt="Always allow checkbox for MCP tools" width="120" caption="Always allow checkbox for MCP tools" /%}

When enabled, Kilo Code will automatically approve this specific tool without prompting. Note that the global "Use MCP servers" setting takes precedence - if it's disabled, no MCP tools will be auto-approved.

{% /tab %}
{% /tabs %}

## Platform-Specific MCP Configuration Examples

{% tabs %}
{% tab label="VSCode (Legacy)" %}

### Windows Configuration Example

When setting up MCP servers on Windows, you'll need to use the Windows Command Prompt (`cmd`) to execute commands. Here's an example of configuring a Puppeteer MCP server on Windows:

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@modelcontextprotocol/server-puppeteer"]
    }
  }
}
```

This Windows-specific configuration:

- Uses the `cmd` command to access the Windows Command Prompt
- Uses `/c` to tell cmd to execute the command and then terminate
- Uses `npx` to run the package without installing it permanently
- The `-y` flag automatically answers "yes" to any prompts during installation
- Runs the `@modelcontextprotocol/server-puppeteer` package which provides browser automation capabilities

{% callout type="note" %}
For macOS or Linux, you would use a different configuration:

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
    }
  }
}
```

{% /callout %}

{% /tab %}
{% tab label="VSCode" %}

In the VS Code extension, use **Settings → MCP → Add Server** to add any of the examples below through the UI. You can also edit the config files directly — see the **CLI** tab for the JSON format.

{% /tab %}
{% tab label="CLI" %}

### Windows

When setting up local MCP servers on Windows, use the full `cmd` invocation in the `command` array:

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

The same approach can be used for other MCP servers on Windows, adjusting the package name as needed for different server types.

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

{% /tab %}
{% /tabs %}

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
{% tab label="VSCode (Legacy)" %}

- **Server Not Responding:** Check if the server process is running and verify network connectivity
- **Permission Errors:** Ensure proper API keys and credentials are configured in your `mcp_settings.json` (for global settings) or `.kilocode/mcp.json` (for project settings).
- **Tool Not Available:** Confirm the server is properly implementing the tool and it's not disabled in settings
- **Slow Performance:** Try adjusting the network timeout value for the specific MCP server

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
