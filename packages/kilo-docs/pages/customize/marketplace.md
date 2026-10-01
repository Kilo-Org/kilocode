---
title: "Marketplace"
description: "Install agents, skills, MCP servers, and plugins from the Kilo Marketplace"
---

# Marketplace

The Kilo Marketplace provides reusable extensions for Kilo. Open **Marketplace** from the Kilo sidebar to browse, install, and remove items.

Marketplace items are configuration, instruction, and plugin files, not VS Code extensions. Installing an item adds files or configuration entries to either the current project or your user configuration. Kilo then discovers those files through its normal configuration system.

## What you can install

| Type | What it adds | What happens after installation |
|---|---|---|
| **Agent** | A reusable role with its own prompt, behavior, and permissions. | The agent becomes available in Kilo's agent selector. |
| **Skill** | Task-specific instructions and resources that Kilo can load when relevant. | Kilo can discover and load the skill during a session. |
| **MCP server** | Tools supplied by an external service or a program running on your machine. | Kilo starts or connects to the configured server when it loads the MCP configuration. |
| **Plugin** | Custom hooks, tools, auth providers, model providers, and runtime behavior. | Kilo adds the plugin to the `plugin` array in the relevant config file and loads it at startup. |

MCP stands for **Model Context Protocol**, a standard that lets AI applications use external tools. For example, an MCP server might let Kilo query a database, work with GitHub, or interact with a browser. See [What is MCP?](/docs/automate/mcp/what-is-mcp) for a fuller explanation.

## Project or global

Every installation has a scope:

| Scope | Availability | Use it when |
|---|---|---|
| **Project** | Only the current project. Files are stored under the project's `.kilo/` directory. | The whole team should use the item, or it is specific to this repository. |
| **Global** | Every project you open on this machine. Files are stored in your user configuration. | The item is part of your personal workflow across repositories. |

Project files can be committed to version control and shared with teammates. Global files remain on your machine and do not travel with a repository.

When the same configuration exists at both scopes, project configuration takes precedence over global configuration. Learn more about [Kilo's configuration files and precedence](/docs/getting-started/settings#config-file-precedence).

## Files changed by installation

The install dialog shows the destination before it changes anything.

| Type | Project destination | Global destination |
|---|---|---|
| Agent | `.kilo/agents/<name>.md` | `~/.config/kilo/agents/<name>.md` |
| Skill | `.kilo/skills/<name>/` | `~/.kilo/skills/<name>/` |
| MCP server | `.kilo/kilo.json` | `~/.config/kilo/kilo.json` |
| Plugin | `.kilo/opencode.json`, `.kilo/tui.json` | `~/.config/kilo/opencode.json`, `~/.config/kilo/tui.json` |

Installing an MCP server adds an entry under the `mcp` key without replacing your other Kilo settings. Installing an agent or skill creates its own file or directory. Installing a plugin adds its specifier to the `plugin` array in the relevant config file. A server plugin updates the server config (`opencode.json`) and a TUI plugin updates `tui.json`, so a plugin that supports both targets changes both files. Removing an item deletes its marketplace-managed entry from the selected scope.

### MCP servers with companion skills

An MCP server can include skills that explain how to use its tools. The install dialog lists these skills and their destinations before you install. One installation adds the server configuration and all companion skills in the selected scope. This works with both remote and local MCP servers; it does not require a Kilo plugin.

Kilo downloads and validates the skills before it installs the bundle. If a skill directory already exists in the selected scope, installation stops without overwriting it. Remove or rename the existing skill before you retry. Project and global installations remain separate.

Kilo records which skills belong to the installation. Removing the MCP also removes its owned companion skills and their resources, even when the catalog is unavailable or has changed. Separately installed skills are not removed. Do not delete the ownership records if you want Kilo to clean up the bundle on removal. Back up edits to bundled skills before you remove the server.

Skills use Kilo's normal discovery and permission rules. Installing a bundle does not approve MCP tool calls or run scripts included in a skill.

{% callout type="warning" title="Keep credentials out of version control" %}
Some MCP servers require API keys, access tokens, or connection strings. Project configuration may be committed to your repository. Prefer environment-variable references for secrets, and review `.kilo/kilo.json` before committing it.
{% /callout %}

## MCP security and permissions

An MCP server can expose tools that read data, modify external systems, or run local operations:

- A **local** MCP server runs a command as a child process on your machine.
- A **remote** MCP server sends requests to an external service.
- Installing the server makes its tools available; it does not automatically approve every tool call.
- MCP tools follow Kilo's `allow`, `ask`, and `deny` permission rules. The default experience may prompt you before a tool runs, depending on your configuration.

Review the item's author, source link, prerequisites, requested parameters, and available tools before installing it. See [Using MCP in Kilo Code](/docs/automate/mcp/using-in-kilo-code) for configuration, transport, authentication, and permission details.

## Plugin security

Plugins run code with full permissions. A plugin can read and change your files, run commands, and access your credentials and network. Install only plugins that you trust, and review the plugin source and its dependencies before you install it. Marketplace validation is not a security review.

## Removing an item

An item can be installed at both project and global scope. Its Marketplace card shows it as installed and offers a separate remove action for each installed scope. Removing the project copy does not remove the global copy, and vice versa.

After an install or removal, Kilo reloads the affected configuration. Running sessions may be interrupted so they do not continue with an outdated set of agents, skills, or tools.

## Contributing

Marketplace entries are maintained in the [Kilo Marketplace repository](https://github.com/Kilo-Org/kilo-marketplace). Contributions should document prerequisites, parameters, available tools, and any platform-specific requirements.

To publish an MCP server with companion skills:

1. Add or import each skill into the marketplace's `skills/<skill-id>/` directory. Its `SKILL.md` must have a `name` that matches the skill ID and a non-empty `description`. Include any required reference files or scripts in that directory.
2. Publish the skill archives through the marketplace's packaging workflow. Verify that the release assets are available before you publish an MCP entry that uses them.
3. Add a top-level `skills` list to `mcps/<server-id>/MCP.yaml`:

```yaml
skills:
  - example-workflow
  - example-reference
```

4. Run the marketplace's validation and generation commands, then submit the MCP entry and generated catalog. The generator checks the skill IDs and adds their archive URLs to the catalog. The existing `requirements.skills` field does not install companion skills.

Users need a Kilo CLI version with companion-skill support. The VS Code extension uses its bundled CLI; the JetBrains plugin uses its pinned CLI. Publish bundles only after the relevant client release includes that support. Older clients can ignore the companion list and install only the MCP configuration.
