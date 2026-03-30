---
title: "Custom Instructions"
description: "Provide custom instructions to guide Kilo Code"
---

# Custom Instructions

Custom Instructions allow you to personalize how Kilo Code behaves, providing specific guidance that shapes responses, coding style, and decision-making processes.

## What Are Custom Instructions?

Custom Instructions define specific Extension behaviors, preferences, and constraints beyond Kilo's basic role definition. Examples include coding style, documentation standards, testing requirements, and workflow guidelines.

{% callout type="info" title="Custom Instructions vs Rules" %}
Custom Instructions are IDE-wide and are applied across all workspaces and maintain your preferences regardless of which project you're working on. Unlike Instructions, [Custom Rules](/docs/customize/custom-rules) are project specific and allow you to setup workspace-based ruleset.
{% /callout %}

## Setting Custom Instructions

{% tabs %}
{% tab label="VSCode" %}

In the new extension, global and agent-specific instructions are managed through config files and agent Markdown files rather than a UI text area.

**Global instructions** (applied to all agents) — add an `instructions` array to your global config (`~/.config/kilo/kilo.jsonc`):

```json
{
  "instructions": ["~/.config/kilo/global-rules.md"]
}
```

**Agent-specific instructions** — include them directly in the agent's Markdown file body (`.kilo/agents/my-agent.md`):

```markdown
---
model: anthropic/claude-3-5-sonnet-20241022
---

You are a test engineer focused on code quality.
Always write tests in the describe/it style.
Include meaningful test descriptions.
```

You can also manage instruction file references from:

1. Click the {% codicon name="gear" /%} icon in the sidebar toolbar to open Settings.
2. Click `Agent Behaviour` → `Rules` sub-tab.
3. Add or remove instruction file paths.

### Agent-Specific Instructions

Agent-specific instructions are written directly in the agent Markdown file body (`.kilo/agents/{agent-name}.md`). The file content after the YAML frontmatter is used as the agent's system prompt.

For version-controlled per-agent instructions, simply commit the `.kilo/agents/` directory.

{% /tab %}
{% tab label="VSCode (Legacy)" %}

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
- Fallback: `.kilorules-{mode-slug}` (single file)

{% callout type="info" title="Legacy Naming Note" %}
Older naming like `.clinerules-{mode-slug}` is not the recommended path for current Kilo mode-specific instructions.
{% /callout %}

{% /tab %}
{% /tabs %}

## Related Features

- [Custom Modes](/docs/customize/custom-modes)
- [Custom Rules](/docs/customize/custom-rules)
- [Settings Management](/docs/getting-started/settings)
- [Auto-Approval Settings](/docs/getting-started/settings/auto-approving-actions)
