---
title: "Using MCP in CLI"
description: "How to configure and use MCP servers in the Kilo CLI"
---

# Using MCP in the CLI

The Kilo CLI supports both local and remote MCP servers. Once added, MCP tools are automatically available to the LLM alongside built-in tools.

{% callout type="tip" %}
MCP servers add to your context, so be careful with which ones you enable. Certain MCP servers with many tools can quickly add up and exceed the context limit.
{% /callout %}

## Configuration Location

The CLI accepts several config filenames. The recommended file is `kilo.json`:

| Scope       | Recommended Path                     | Also supported              |
| ----------- | ------------------------------------ | --------------------------- |
| **Global**  | `~/.config/kilo/kilo.json`           | `kilo.jsonc`, `config.json` |
| **Project** | `./kilo.json` or `./.kilo/kilo.json` | `kilo.jsonc`                |

Project-level configuration takes precedence over global settings. 

## Configuration Format

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

## Transport Types

### Local Servers

Local MCP servers run on your machine and communicate via standard input/output. Set `type` to `"local"`.

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

| Option        | Type    | Required | Description                                                          |
| ------------- | ------- | -------- | -------------------------------------------------------------------- |
| `type`        | String  | Yes      | Must be `"local"`.                                                   |
| `command`     | Array   | Yes      | Command and arguments to run the MCP server.                         |
| `environment` | Object  | No       | Environment variables to set when running the server.                |
| `enabled`     | Boolean | No       | Enable or disable the MCP server on startup.                         |
| `timeout`     | Number  | No       | Timeout in ms for fetching tools from the MCP server. Default: 5000. |

### Remote Servers

Remote MCP servers are accessed over HTTP/HTTPS. Set `type` to `"remote"`.

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

| Option    | Type    | Required | Description                                                          |
| --------- | ------- | -------- | -------------------------------------------------------------------- |
| `type`    | String  | Yes      | Must be `"remote"`.                                                  |
| `url`     | String  | Yes      | URL of the remote MCP server.                                        |
| `enabled` | Boolean | No       | Enable or disable the MCP server on startup.                         |
| `headers` | Object  | No       | HTTP headers to send with requests.                                  |
| `timeout` | Number  | No       | Timeout in ms for fetching tools from the MCP server. Default: 5000. |

## Managing MCP Servers

You can manage MCP servers from the CLI:

| Command         | Description                     |
| --------------- | ------------------------------- |
| `kilo mcp list` | List all configured MCP servers |
| `kilo mcp add`  | Add an MCP server               |
| `kilo mcp auth` | Authenticate with an MCP server |

Inside the interactive TUI, use the `/mcps` slash command to toggle MCP servers on or off.

## Examples

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

## Environment Variables

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

## Finding MCP Servers

Browse community-contributed MCP server configurations and agent skills in the [Kilo Marketplace](https://github.com/Kilo-Org/kilo-marketplace). The marketplace includes ready-to-use configs for popular tools like Figma, Sentry, and more.
