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

Kilo reads JSONC config from a **global** location (`~/.config/kilo/kilo.jsonc`) and from your **project** (`kilo.jsonc`, or `.kilo/kilo.jsonc`). All clients — CLI, VS Code, and JetBrains — read the same files.

If `kilo.json` or the legacy `opencode.json`, `opencode.jsonc`, or `config.json` files exist in the same locations, Kilo reads and deep-merges them as well. Clearing a setting in the Settings UI (for example, setting a model back to "Not set") removes it from every config file that contains it.

{% callout type="warning" %}
**Migrating from opencode?** Kilo no longer falls back to opencode configuration stored in `.opencode` directories (such as `~/.config/opencode` or a project `./.opencode/`). To keep using it, move your global config into `~/.config/kilo/` and any project config into `./.kilo/`.
{% /callout %}

{% tabs %}
{% tab label="VSCode" %}

The VS Code extension provides a **Settings webview UI** accessible from Kilo Code by clicking the gear icon ({% codicon name="gear" /%}). The UI is organized into tabs including Providers, Auto-Approve, Models, and more.

This UI reads and writes to the same underlying JSONC config files used across extension surfaces. Changes apply to the sidebar, Agent Manager, and the CLI when used directly.

### Config File Locations

There are two primary config files:

- **Global config:** `~/.config/kilo/kilo.jsonc` — applies to all projects. On Windows, this is `C:\Users\<username>\.config\kilo\kilo.jsonc`.
- **Project config:** `kilo.jsonc` in your project root, or `.kilo/kilo.jsonc` for a cleaner setup. The `.kilo/` version takes priority if both exist.

Use **Local Config** or **Global Config** in the Settings header to open the matching config file from VS Code. If multiple config files are available, choose the exact file from the picker. If the recommended file does not exist yet, Kilo creates it before opening it.

{% callout type="warning" %}
If you check config files into version control, make sure they do not contain API keys or other secrets (e.g., `provider.*.options.apiKey`). Use environment variables for credentials instead.
{% /callout %}

### Voice Transcription Model

When the Kilo provider is enabled and you are signed in, choose the transcription model under **Models** > **Speech to Text Model**. This stores `experimental.speech_to_text_model` in your global Kilo CLI config:

```json
{
  "experimental": {
    "speech_to_text_model": "openai/whisper-large-v3-turbo"
  }
}
```

### Voice Transcription Source

By default both the model list and the audio go to Kilo Gateway. Set **Models** > **Speech to Text Base URL** to send them to any OpenAI-compatible transcription API instead, with an optional bearer token:

```json
{
  "experimental": {
    "speech_to_text_base_url": "https://api.openai.com/v1",
    "speech_to_text_api_key": "sk-...",
    "speech_to_text_model": "whisper-1"
  }
}
```

Models are read from `{base_url}/models` and audio is posted to `{base_url}/audio/transcriptions`. Leave the base URL empty to use Kilo Gateway. See [Voice Transcription](/docs/code-with-ai/features/speech-to-text) for details.

### Prompt-Training Model Visibility

Enable **Hide Prompt-Training Models** under **Models** to remove Kilo Gateway models whose providers may use your prompts for training from model lists. Models from other providers and models without explicit prompt-training metadata remain visible. The setting is disabled by default.

You can also enable it in `kilo.jsonc`:

```json
{
  "hide_prompt_training_models": true
}
```

### Compaction Model

Choose the model used for automatic and manual compaction under **Models** > **Compaction Model**. Leave it unset to use the chat model. The Compaction section in **Settings → Context** links to this selector.

This stores `agent.compaction.model` in `kilo.jsonc`:

```json
{
  "agent": {
    "compaction": {
      "model": "anthropic/claude-haiku-4-5"
    }
  }
}
```

### Reasoning Blocks

Reasoning blocks show the agent's thinking. Choose a mode for **Reasoning Blocks** in the Display tab, or set `reasoning_display` in `kilo.jsonc`:

```json
{
  "reasoning_display": "preview"
}
```

- `expanded`: The full reasoning text stays open.
- `preview`: A short scrolling preview shows while the agent is writing and stays compact after it finishes. Blocks from earlier sessions start collapsed.
- `headline`: Only the header and streaming indicator show until you open the block.

Valid values are `expanded`, `preview`, and `headline`. The default is `expanded`.

Older configs that set `auto_collapse_reasoning: true` map to `preview`. That boolean is deprecated, so use `reasoning_display` instead.

### Terminal Command Blocks

Terminal command blocks stay expanded by default in the VS Code chat UI. Choose **Collapsed** for **Terminal Command Blocks** in the Display tab, or set `terminal_command_display` in `kilo.jsonc`, to start them collapsed:

```json
{
  "terminal_command_display": "collapsed"
}
```

Valid values are `expanded` and `collapsed`.

### Code Edit and Tool Blocks

Code edit and diff blocks start collapsed. Choose **Expanded** for **Code Edit Blocks** in the Display tab, or set `code_edit_display` in `kilo.jsonc`. MCP and generic tool blocks also start collapsed, controlled by `mcp_tool_display`:

```json
{
  "code_edit_display": "expanded",
  "mcp_tool_display": "expanded"
}
```

Both keys accept `expanded` and `collapsed`.

### Inline Code

Inline code keeps its current text-only appearance by default. Enable **Highlight Inline Code** in the Display tab, or set `inline_code_background` to `true`, to add a theme-aware background and spacing. You can independently set `inline_code_color` to a hex color:

```json
{
  "inline_code_background": true,
  "inline_code_color": "#9dbefe"
}
```

Omit either setting to keep its current theme-controlled behavior.

### Work Styles and the Session Preview

Onboarding asks you to pick a work style. The choice sets display defaults and, for **Review first**, permission rules:

- **Review first** expands reasoning, terminal, and code edit blocks, collapses MCP and generic tool blocks, and shows auto-approval reasons. It also allows read-only commands and asks before edits, external directory access, and other commands.
- **High autonomy** uses a reasoning preview, collapses terminal, code edit, and tool blocks, and hides auto-approval reasons. It leaves permissions unchanged.

Onboarding only fills settings and permission rules that are not already configured, so an existing `kilo.jsonc` or customized settings are preserved.

You can change both choices later:

- **Settings → Display** holds the display options. The **Display presets** buttons apply the same combinations as onboarding, and each option stays individually editable. A looping sample conversation beside the options previews your changes with the same components as a real session, using local data only.
- **Settings → Auto-Approve** lists the current permission rules and lets you edit them.

Display changes apply as a draft. Click **Save** to keep them or **Discard** to revert.

### Markdown Diff Rendering

Markdown files in Kilo diff viewers can be shown as rendered Markdown instead of a raw text diff. Use the eye/code toggle in a Markdown file header, or set `kilo-code.new.diff.renderMarkdown` to `true` to render Markdown files by default.

### Web Search

See [Web Search Availability](/docs/automate/tools#web-search-availability) for how to enable the `websearch` tool for models from all providers.

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
{% /tabs %}

## Sandbox

On macOS and Linux, the VS Code extension includes a dedicated **Sandboxing** settings tab. The sandbox is disabled by default. When enabled, it limits agent filesystem writes and can block outbound network access from model-originated tools. Windows users do not see these settings because Windows sandboxing is not supported.

See [Sandboxing](/docs/getting-started/settings/sandboxing) for setup instructions, the exact filesystem and network boundaries, and platform limitations.

## Kilo Swarm

Kilo Swarm lets a main session and its task descendants, including nested subagents, exchange messages on a shared board. It uses the existing Task tool, not a separate agent runtime. The board is not shared with unrelated sessions, even in the same repository or worktree.

Kilo Swarm is on by default. Turn it off in the VS Code or JetBrains **Agent Behaviour** settings, or set `shared_agent_board` to `false` in `kilo.jsonc`.

Use it when agents can benefit from discoveries during work:

- **Search races:** agents try independent approaches to the same problem and share useful findings.
- **Complementary teams:** agents work on different parts of a feature and share constraints or results.

Straightforward tasks can stay solo. Enabling the board does not mean agents are always running or that every task needs a team.

**Post message** (`board_post`) stores a message on the shared board. **Read messages** (`board_read`) retrieves messages from the board explicitly. Activity notices are best-effort: a stored message does not prove that a recipient was notified, read it, or acted on it. Posting does not start or resume an agent, and normal task completion still returns results to the parent.

All participants can read the board history, including messages addressed to others. Recipient selection is not a privacy boundary. Peer messages do not grant user approval or change permissions; `HOLD` and `VETO` are advisory, not controls that pause or cancel work.

When a main session has board messages, open the **Board** icon in its task header (VS Code) or session header (JetBrains, which also offers a **View Kilo Swarm** session menu action) to read them, refresh them, or reset the board. Only the owning top-level session can view or reset its board; child sessions and cloud sessions cannot. Reset clears visible messages only and does not stop agents or clear conversations. See [Kilo Swarm communication](/docs/automate/agent-manager#kilo-swarm-communication) for the board dialog, ownership rules, and recipient-state warnings.

## Experimental Features

{% tabs %}
{% tab label="VSCode" %}

The new extension exposes experimental features via the **Experimental** tab in Settings (click the gear icon {% codicon name="gear" /%} → Experimental).

Available experimental settings include:

- **Share mode** - `manual`, `auto`, or `disabled` session sharing
- **LSP integration** - expose language server diagnostics to the agent
- **Paste summary** - summarize large clipboard pastes before including them
- **Batch tool** - allow the agent to batch multiple tool calls in one step
- **Task Subagent Model Selection** - let you request a different model or reasoning effort for an individual subagent task (off by default)
- **Claude Code Migration** - import supported global Claude Code configuration once (off by default)
- **OpenTelemetry** - enable Kilo telemetry and optional OTLP export when configured

Advanced options not exposed in the UI can be configured via the `experimental` key in `kilo.jsonc`:

```json
{
  "experimental": {
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

The CLI does not expose these options through an IDE settings panel. Configure model behavior, permissions, telemetry, and other advanced options directly in JSONC config files. Refer to the auto-generated `$schema` in your `kilo.jsonc` for the full list of available options.

Telemetry is enabled by default. Set `experimental.openTelemetry` to `false` in `kilo.jsonc` to opt out. If `OTEL_EXPORTER_OTLP_ENDPOINT` is set in the environment, the CLI also exports OpenTelemetry traces and logs to that OTLP HTTP endpoint.

{% /tab %}
{% /tabs %}

### Task subagent model selection

Enable **Task Subagent Model Selection** in **Settings → Experimental**, or set `experimental.task_model_selection` to `true` in `kilo.jsonc`. It is off by default.

This lets you explicitly request a different model, provider, or reasoning effort for an individual subagent task. The agent keeps normal defaults unless you request an override; it does not select models autonomously for cost or complexity. See [Per-task model selection](/docs/code-with-ai/agents/model-selection#per-task-model-selection-experimental).

### Claude Code migration

Enable **Claude Code Migration** in **Settings → Experimental** to import supported global Claude Code configuration on the next backend start. It is off by default and runs once, with no automatic retry.

The migration imports:

- Global instructions from `~/.claude/CLAUDE.md` into Kilo's global `AGENTS.md`.
- Standalone skills from `~/.claude/skills/` that contain only a `SKILL.md`.
- Top-level MCP server definitions from `~/.claude.json`, disabled until you enable them.

Existing Kilo content takes precedence; conflicts and unsupported items are skipped. Your original Claude files are not changed or deleted. After the attempt, Kilo stops loading global Claude instructions and skills as a fallback, but project-level compatibility such as a repository's `CLAUDE.md` is unaffected. A notification reports the outcome and points to a receipt with imported, skipped, and failed items.
