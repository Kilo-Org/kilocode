---
title: "Custom Instructions"
description: "Provide custom instructions to guide Kilo Code"
---

# Custom Instructions

Custom Instructions allow you to personalize how Kilo Code behaves, providing specific guidance that shapes responses, coding style, and decision-making processes. Both the **VSCode** and **CLI** versions support custom instructions, though the mechanisms differ.

## What Are Custom Instructions?

Custom Instructions define specific Extension behaviors, preferences, and constraints beyond Kilo's basic role definition. Examples include coding style, documentation standards, testing requirements, and workflow guidelines.

{% tabs %}
{% tab label="VSCode" %}

The extension provides multiple layers of instruction configuration — from per-agent prompts in the Settings UI to auto-discovered files in your project and global config.

## Per-Agent Prompts

Each agent can have its own custom prompt configured through the settings UI:

1. Open **Settings → Agent Behaviour → Agents** subtab
2. Select the agent you want to customize
3. Enter your instructions in the markdown text area under the agent's `prompt` field
4. Save your changes

These prompts are injected into the agent's system prompt and apply across all sessions using that agent.

## Instruction Files

Kilo automatically discovers instruction files at your project root and in parent directories (via `findUp`). The following filenames are recognized:

- **`AGENTS.md`** — The primary instruction file for Kilo
- **`CLAUDE.md`** — Also supported for compatibility
- **`CONTEXT.md`** — Additional project context

Place any of these files at your project root to provide project-wide instructions to the agent.

### Global Instructions

For instructions that apply across all your projects, place an `AGENTS.md` file in your global config directory:

- **Kilo:** `~/.config/kilo/AGENTS.md`
- **Claude-compatible:** `~/.claude/CLAUDE.md`

Project-level instructions are loaded before global instructions and apply to every session.

### Per-Directory Instructions

You can place `AGENTS.md` files in any subdirectory of your project. These are loaded dynamically — when the agent's Read tool accesses a file in that directory, the corresponding `AGENTS.md` is discovered and its contents are injected into the conversation as `<system-reminder>` tags.

This is useful for providing context-specific guidance for different parts of a monorepo or project.

## Additional Instruction Sources

The `instructions` key in `kilo.jsonc` accepts an array of paths, globs, or URLs pointing to additional instruction files. You can manage these in **Settings → Agent Behaviour → Rules** subtab.

```yaml
# Examples of instruction sources
instructions:
  - ./docs/coding-standards.md
  - ./teams/frontend-rules.md
  - https://example.com/team-instructions.md
```

{% callout type="info" title="URL-Based Instructions" %}
URL-based instruction sources are fetched at session start with a 5-second timeout. If the URL is unreachable, the instruction source is silently skipped.
{% /callout %}

## Legacy `.kilocoderules` Support

If your project contains `.kilocoderules` files from the VSCode extension, these are still loaded via auto-migration. However, migrating to `AGENTS.md` is recommended for new projects.

{% /tab %}
{% tab label="CLI" %}

The CLI provides multiple layers of instruction configuration — from per-agent prompts in agent definition files to auto-discovered files in your project and global config.

## Per-Agent Prompts

Each agent can have its own custom prompt defined in its `.md` file (the markdown body) or via the `agent.<name>.prompt` key in `kilo.jsonc`:

```jsonc
// kilo.jsonc
{
  "agent": {
    "code": {
      "prompt": "You are a Python specialist. Follow PEP8 strictly.",
    },
  },
}
```

Or as the markdown body in `.kilo/agents/code.md`:

```markdown
---
description: Python specialist
---

You are a Python specialist. Follow PEP8 strictly.
```

These prompts are injected into the agent's system prompt and apply across all sessions using that agent.

## Instruction Files

Kilo automatically discovers instruction files at your project root and in parent directories (via `findUp`). The following filenames are recognized:

- **`AGENTS.md`** — The primary instruction file for Kilo
- **`CLAUDE.md`** — Also supported for compatibility
- **`CONTEXT.md`** — Additional project context

Place any of these files at your project root to provide project-wide instructions to the agent.

### Global Instructions

For instructions that apply across all your projects, place an `AGENTS.md` file in your global config directory:

- **Kilo:** `~/.config/kilo/AGENTS.md`
- **Claude-compatible:** `~/.claude/CLAUDE.md`

Project-level instructions are loaded before global instructions and apply to every session.

### Per-Directory Instructions

You can place `AGENTS.md` files in any subdirectory of your project. These are loaded dynamically — when the agent's Read tool accesses a file in that directory, the corresponding `AGENTS.md` is discovered and its contents are injected into the conversation as `<system-reminder>` tags.

This is useful for providing context-specific guidance for different parts of a monorepo or project.

## Additional Instruction Sources

The `instructions` key in `kilo.jsonc` accepts an array of paths, globs, or URLs pointing to additional instruction files. Configure these in your `kilo.jsonc`:

```jsonc
// kilo.jsonc
{
  "instructions": [
    "./docs/coding-standards.md",
    "./teams/frontend-rules.md",
    "https://example.com/team-instructions.md",
  ],
}
```

{% callout type="info" title="URL-Based Instructions" %}
URL-based instruction sources are fetched at session start with a 5-second timeout. If the URL is unreachable, the instruction source is silently skipped.
{% /callout %}

## Legacy `.kilocoderules` Support

If your project contains `.kilocoderules` files from the VSCode extension, these are still loaded via auto-migration. However, migrating to `AGENTS.md` is recommended for new projects.

{% /tab %}
{% tab label="VSCode (Legacy)" %}

## Setting Custom Instructions

{% callout type="info" title="Custom Instructions vs Rules" %}
Custom Instructions are IDE-wide and are applied across all workspaces and maintain your preferences regardless of which project you're working on. Unlike Instructions, [Custom Rules](/docs/customize/custom-rules) are project specific and allow you to setup workspace-based ruleset.
{% /callout %}

**How to set them:**

{% image src="/docs/img/custom-instructions/custom-instructions.png" alt="Kilo Code Modes tab showing global custom instructions interface" width="600" caption="Kilo Code Modes tab showing global custom instructions interface" /%}

1.  **Open Modes Tab:** Click the <Codicon name="notebook" /> icon in the Kilo Code top menu bar
2.  **Find Section:** Find the "Custom Instructions for All Modes" section
3.  **Enter Instructions:** Enter your instructions in the text area
4.  **Save Changes:** Click "Done" to save your changes

#### Mode-Specific Instructions

Mode-specific instructions can be set using the Modes Tab

    {% image src="/docs/img/custom-instructions/custom-instructions-3.png" alt="Kilo Code Modes tab showing mode-specific custom instructions interface" width="600" caption="Kilo Code Modes tab showing mode-specific custom instructions interface" /%}
    * **Open Tab:** Click the <Codicon name="notebook" /> icon in the Kilo Code top menu bar
    * **Select Mode:** Under the Modes heading, click the button for the mode you want to customize
    * **Enter Instructions:** Enter your instructions in the text area under "Mode-specific Custom Instructions (optional)"
    * **Save Changes:** Click "Done" to save your changes

        {% callout type="info" title="Global Mode Rules" %}

If the mode itself is global (not workspace-specific), any custom instructions you set for it will also apply globally for that mode across all workspaces.
{% /callout %}

#### Mode-Specific Instructions from Files

For version-controlled mode instructions, use the mode rules file paths documented in [Custom Modes](/docs/customize/custom-modes#mode-specific-instructions-via-filesdirectories):

- Preferred: `.kilo/rules-{mode-slug}/` (directory)
- Fallback: `.kilocoderules-{mode-slug}` (single file)

{% callout type="info" title="Legacy Naming Note" %}
Only `.kilocoderules-{mode-slug}` is recognized as the legacy fallback. Older naming like `.clinerules-{mode-slug}` is not supported.
{% /callout %}

{% /tab %}
{% /tabs %}

## Related Features

- [Custom Modes](/docs/customize/custom-modes)
- [Custom Rules](/docs/customize/custom-rules)
- [Settings Management](/docs/getting-started/settings)
- [Auto-Approval Settings](/docs/getting-started/settings/auto-approving-actions)
