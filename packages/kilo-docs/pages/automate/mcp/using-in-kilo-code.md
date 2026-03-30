---
title: "Using MCP in Kilo Code"
description: "How to use MCP servers in Kilo Code"
---

# Using MCP in Kilo Code

Model Context Protocol (MCP) extends Kilo Code's capabilities by connecting to external tools and services. This guide covers everything you need to know about using MCP with Kilo Code.

{% youtube url="https://youtu.be/6O9RQoQRX8A" caption="Demostrating MCP installation in Kilo Code" /%}

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

MCP server configurations can be managed at two levels:

1. **Global Configuration**: Stored in the `mcp_settings.json` file, accessible via VS Code settings (see below). These settings apply across all your workspaces unless overridden by a project-level configuration.
2. **Project-level Configuration**: Defined in a `.kilocode/mcp.json` file within your project's root directory. This allows you to set up project-specific servers and share configurations with your team by committing the file to version control. Kilo Code automatically detects and loads this file if it exists.

**Precedence**: If a server name exists in both global and project configurations, the **project-level configuration takes precedence**.

### Editing MCP Settings Files

You can edit both global and project-level MCP configuration files directly from the Kilo Code settings.

1. Click the {% codicon name="gear" /%} icon in the top navigation of the Kilo Code pane to open `Settings`.
2. Click the `Agent Behaviour` tab on the left side
3. Select the `MCP Servers` sub-tab
4. Click the appropriate button:
   - **`Edit Global MCP`**: Opens the global `mcp_settings.json` file.
   - **`Edit Project MCP`**: Opens the project-specific `.kilocode/mcp.json` file. If this file doesn't exist, Kilo Code will create it for you.

{% image src="/docs/img/using-mcp-in-kilo-code/mcp-installed-config.png" alt="Edit Global MCP and Edit Project MCP buttons" width="600" caption="Edit Global MCP and Edit Project MCP buttons" /%}

Both files use a JSON format with a `mcpServers` object containing named server configurations:

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
{% /tabs %}

## Understanding Transport Types

{% tabs %}
{% tab label="VSCode" %}

MCP supports two transport types:

#### Local (STDIO) Transport

Used for servers running on your machine as a child process:

- Communicates via standard input/output streams
- Lower latency (no network overhead)
- Better security (no network exposure)

#### Remote (HTTP/SSE) Transport

Used for servers accessed over HTTP/HTTPS:

- Can be hosted on a different machine
- Supports multiple client connections
- Requires network access
- Supports OAuth 2.0 authentication

Kilo Code tries `StreamableHTTP` first, then falls back to `SSE` transport automatically for remote servers.

For more details, see [STDIO & SSE Transports](server-transports).

{% /tab %}
{% tab label="VSCode (Legacy)" %}

MCP supports three transport types for server communication:

#### STDIO Transport

Used for local servers running on your machine:

- Communicates via standard input/output streams
- Lower latency (no network overhead)
- Better security (no network exposure)
- Simpler setup (no HTTP server needed)
- Runs as a child process on your machine

For more in-depth information about how STDIO transport works, see [STDIO Transport](server-transports#stdio-transport).

STDIO configuration example:

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

#### Streamable HTTP Transport

Used for remote servers accessed over HTTP/HTTPS:

- Can be hosted on a different machine
- Supports multiple client connections
- Requires network access
- Allows centralized deployment and management

Streamable HTTP transport configuration example:

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

#### SSE Transport

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

{% /tab %}
{% /tabs %}

### Deleting a Server

1. Press the {% codicon name="trash" /%} next to the MCP server you would like to delete
2. Press the `Delete` button on the confirmation box

{% image src="/docs/img/using-mcp-in-kilo-code/using-mcp-in-kilo-code-5.png" alt="Delete confirmation box" width="400" caption="Delete confirmation box" /%}

### Restarting a Server

1. Press the {% codicon name="refresh" /%} button next to the MCP server you would like to restart

### Enabling or Disabling a Server

1. Press the {% codicon name="activate" /%} toggle switch next to the MCP server to enable/disable it

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

## Finding and Installing MCP Servers

Kilo Code does not come with any pre-installed MCP servers. You'll need to find and install them separately.

- **Kilo Marketplace:** Browse and install MCP servers directly from the Marketplace tab in the extension sidebar
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

Common issues and solutions:

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
{% /tabs %}

{% callout type="tip" %}
**Reduce system prompt size:** If you're not using MCP, turn it off in Settings > Agent Behaviour > MCP Servers to significantly cut down the size of the system prompt and improve performance.
{% /callout %}

## Platform-Specific MCP Configuration Examples

### Windows Configuration Example

{% tabs %}
{% tab label="VSCode" %}

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

{% /tab %}
{% tab label="VSCode (Legacy)" %}

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
{% /tabs %}

The same approach can be used for other MCP servers on Windows, adjusting the package name as needed for different server types.
