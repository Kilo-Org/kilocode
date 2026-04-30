---
title: "Settings"
description: "Configure Kilo Code settings and preferences"
---

# Settings

The VS Code extension can be configured through the Settings window, opened by pressing the gear icon in Kilo Code. Changes apply across extension surfaces, including the sidebar and Agent Manager. The CLI can also use the same JSONC config files when you use it directly.

## Configuring with the Agent

The fastest way to change your Kilo configuration is to ask the agent to do it for you. The agent has a built-in skill that understands the full `kilo.jsonc` schema and can read, create, and update your config files directly.

**Examples of things you can ask:**

- "Switch my default model to Claude Sonnet"
- "Disable the OpenAI and Groq providers"
- "Set up an MCP server for Figma"
- "Auto-approve all read and glob operations"
- "Create a custom agent for code review"

The agent will edit the appropriate config file (global or project-level) and explain what it changed. This works in both the CLI and VS Code extension.

{% callout type="tip" %}
This is especially useful for complex configuration like custom model definitions, MCP server setup, or permission patterns — the agent knows the correct syntax and will validate the config for you.
{% /callout %}

## Managing Settings

{% tabs %}
{% tab label="VSCode" %}

The VS Code extension provides a **Settings webview UI** accessible from Kilo Code by clicking the gear icon ({% codicon name="gear" /%}). The UI is organized into tabs including Providers, Auto-Approve, Models, and more.

This UI reads and writes to the same underlying JSONC config files used across extension surfaces. Changes apply to the sidebar, Agent Manager, and the CLI when used directly.

### Config File Locations

There are two primary config files:

- **Global config:** `~/.config/kilo/kilo.jsonc` — applies to all projects. On Windows, this is `C:\Users\<username>\.config\kilo\kilo.jsonc`.
- **Project config:** `kilo.jsonc` in your project root, or `.kilo/kilo.jsonc` for a cleaner setup. The `.kilo/` version takes priority if both exist.

{% callout type="warning" %}
If you check config files into version control, make sure they do not contain API keys or other secrets (e.g., `provider.*.options.apiKey`). Use environment variables for credentials instead.
{% /callout %}

### Terminal Command Blocks

Terminal command blocks stay expanded by default in the VS Code chat UI. Choose **Collapsed** for **Terminal Command Blocks** in the Display tab, or set `terminal_command_display` in `kilo.jsonc`, to start them collapsed:

```json
{
  "terminal_command_display": "collapsed"
}
```

Valid values are `expanded` and `collapsed`.

### Export and Import

You can export and import settings from the **About Kilo Code** tab in the Settings UI:

- **Export**: Saves your global config as a `kilo-settings.json` file. Review it before sharing, because config values are exported as-is.
- **Import**: Loads a previously exported JSON file into the settings draft. Changes are not applied immediately — you can review them and click Save or Discard, just like any manual edit.

Config files are also plain-text and portable — you can copy `~/.config/kilo/kilo.jsonc` between machines directly.

{% /tab %}
{% tab label="CLI" %}

In the CLI, settings are managed via **JSONC config files** directly. Config files are plain-text and portable -- you can copy them between machines.

{% callout type="warning" %}
If you check `kilo.jsonc` into version control, make sure it does not contain API keys or other secrets (e.g., `provider.*.options.apiKey`). Use environment variables for credentials instead.
{% /callout %}

### Config File Locations

There are two primary config files:

- **Global config:** `~/.config/kilo/kilo.jsonc` -- applies to all projects. On Windows, this is `C:\Users\<username>\.config\kilo\kilo.jsonc`.
- **Project config:** `kilo.jsonc` in the root of your project -- overrides global settings for that project.

Both files use the [JSONC](https://code.visualstudio.com/docs/languages/json#_json-with-comments) format (JSON with comments).

### Config File Precedence

Settings are resolved through an 8-level precedence system (lowest to highest priority):

1. **Legacy Kilocode** -- migrated settings from the VSCode extension
2. **Remote well-known** -- remotely fetched defaults
3. **Global** -- `~/.config/kilo/kilo.jsonc`
4. **Custom** -- additional custom config paths
5. **Project** -- `kilo.jsonc` in the project root
6. **`.kilo` directory** -- config from a `.kilo/` directory in the project
7. **Inline environment** -- environment variable overrides
8. **Managed / Enterprise** -- enterprise-managed configuration (highest priority)

Higher-priority levels override lower ones. This allows organizations to enforce settings at the enterprise level while still letting individual developers customize their local environment.

### Schema Auto-Injection

When you create or open a `kilo.jsonc` file, the CLI automatically injects a `$schema` property pointing to the config JSON schema. This gives you **autocompletion and validation** in any editor that supports JSON Schema (VS Code, JetBrains, etc.).

### Export and Import

There is no traditional export/import of settings -- the JSONC config files themselves are portable. Copy `~/.config/kilo/kilo.jsonc` or `kilo.jsonc` to another machine and you're done.

For **session** export and import, use the CLI commands:

- `kilo export` -- export session data
- `kilo import` -- import session data

{% /tab %}
{% tab label="VSCode (Legacy)" %}

Kilo Code allows you to manage your configuration settings effectively through export, import, and reset options. These features are useful for backing up your setup, sharing configurations with others, or restoring default settings if needed.

You can find these options at the bottom of the Kilo Code settings page, accessible via the gear icon ({% codicon name="gear" /%}) in the Kilo Code chat view.

{% image src="/docs/img/settings-management/settings-management.png" alt="Export, Import, and Reset buttons in Kilo Code settings" width="800" caption="Export, Import, and Reset buttons" /%}

### Export Settings

Clicking the **Export** button saves your current Kilo Code settings to a JSON file.

- **What's Exported:** The file includes your configured API Provider Profiles and Global Settings (UI preferences, mode configurations, context settings, etc.).
- **Security Warning:** The exported JSON file contains **all** your configured API Provider Profiles and Global Settings. Crucially, this includes **API keys in plaintext**. Treat this file as highly sensitive. Do not share it publicly or with untrusted individuals, as it grants access to your API accounts.
- **Process:**
  1.  Click **Export**.
  2.  A file save dialog appears, suggesting `kilo-code-settings.json` as the filename (usually in your `~/Documents` folder).
  3.  Choose a location and save the file.

This creates a backup of your configuration or a file you can share.

### Import Settings

Clicking the **Import** button allows you to load settings from a previously exported JSON file.

- **Process:**
  1.  Click **Import**.
  2.  A file open dialog appears. Select the `kilo-code-settings.json` file (or similarly named file) you want to import.
  3.  Kilo Code reads the file, validates its contents against the expected schema, and applies the settings.
- **Merging:** Importing settings **merges** the configurations. It adds new API profiles and updates existing ones and global settings based on the file content. It does **not** delete configurations present in your current setup but missing from the imported file.
- **Validation:** Only valid settings matching the internal schema can be imported, preventing configuration errors. A success notification appears upon completion.

### Reset Settings

Clicking the **Reset** button completely clears all Kilo Code configuration data and returns the extension to its default state. This is a destructive action intended for troubleshooting or starting fresh.

- **Warning:** This action is **irreversible**. It permanently deletes all API configurations (including keys stored in secret storage), custom modes, global settings, and task history.

- **Process:**
  1.  Click the red **Reset** button.
  2.  A confirmation dialog appears, warning that the action cannot be undone.
  3.  Click "Yes" to confirm.

- **What is Reset:**
  - **API Provider Profiles:** All configurations are deleted from settings and secret storage.
  - **Global Settings:** All preferences (UI, modes, approvals, browser, etc.) are reset to defaults.
  - **Custom Modes:** All user-defined modes are deleted.
  - **Secret Storage:** All API keys and other secrets managed by Kilo Code are cleared.
  - **Task History:** The current task stack is cleared.

- **Result:** Kilo Code returns to its initial state, as if freshly installed, with default settings and no user configurations.

Use this option only if you are certain you want to remove all Kilo Code data or if instructed during troubleshooting. Consider exporting your settings first if you might want to restore them later.

{% /tab %}
{% /tabs %}

## Experimental Features

{% tabs %}
{% tab label="VSCode" %}

The new extension exposes experimental features via the **Experimental** tab in Settings (click the gear icon {% codicon name="gear" /%} → Experimental).

Available experimental toggles include:

- **Share mode** — `manual`, `auto`, or `disabled` session sharing
- **LSP integration** — expose language server diagnostics to the agent
- **Paste summary** — summarize large clipboard pastes before including them
- **Batch tool** — allow the agent to batch multiple tool calls in one step
- **OpenTelemetry** — enable Kilo telemetry and optional OTLP export when configured

Advanced options not exposed in the UI can be configured via the `experimental` key in `kilo.jsonc`:

```json
{
  "experimental": {
    "codebase_search": true,
    "batch_tool": false,
    "openTelemetry": true,
    "disable_paste_summary": false,
    "mcp_timeout": 30000
  }
}
```

Refer to the auto-generated `$schema` in your `kilo.jsonc` for the full list of available options.

{% /tab %}
{% tab label="CLI" %}

The CLI does not currently expose the same experimental feature toggles as the **VSCode (Legacy)** version. Configuration of model behavior, file editing strategies, telemetry, and other advanced options is handled directly in the JSONC config files. Refer to the auto-generated `$schema` in your `kilo.jsonc` for the full list of available options.

Telemetry is enabled by default. Set `experimental.openTelemetry` to `false` in `kilo.jsonc` to opt out. If `OTEL_EXPORTER_OTLP_ENDPOINT` is set in the environment, the CLI also exports OpenTelemetry traces and logs to that OTLP HTTP endpoint.

{% /tab %}
{% tab label="VSCode (Legacy)" %}

{% callout type="info" %}
These features are experimental and may change in future releases. They provide advanced control over Kilo Code's behavior for specific use cases.
{% /callout %}

### Concurrent File Edits

When enabled, Kilo Code can edit multiple files in a single request. When disabled, Kilo Code must edit one file at a time.

**When to disable:**

- Working with less capable models that struggle with complex multi-file operations
- You want more granular control over file modifications
- Debugging issues with file editing behavior

**Default:** Enabled

### Power Steering

When enabled, Kilo Code will remind the model about the details of its current mode definition more frequently. This leads to stronger adherence to role definitions and custom instructions, but will use more tokens per message.

**When to enable:**

- Working with custom modes that have specific role definitions
- You need stricter adherence to custom instructions
- The model is deviating from the intended mode behavior

**Trade-off:** Increased token usage per message in exchange for better mode adherence.

**Default:** Disabled

Learn more about [Custom Modes](/docs/customize/custom-modes) and how Power Steering can improve mode behavior.

### File Read Auto-Truncate Threshold

This setting controls the number of lines read from a file in one batch. To manage large files and reduce context/resource usage, adjust the `File read auto-truncate threshold` setting.

**When to adjust:**

- Working with very large files that consume too much context
- Need to improve performance when reading large files
- Want to reduce token usage for file operations

**Trade-off:** Lower values can improve performance when working with very large files, but may require more read operations to access the full file content.

**Default:** Set in Advanced Settings

You can find this setting in the Kilo Code settings under 'Advanced Settings'.

{% /tab %}
{% /tabs %}
