---
title: "Autocomplete"
description: "AI-powered code autocompletion in Kilo Code"
---

# Autocomplete

Kilo Code's autocomplete feature provides intelligent code suggestions and completions while you're typing, helping you write code faster and more efficiently. It offers both automatic and manual triggering options.

## How Autocomplete Works

The extension uses **Fill-in-the-Middle (FIM)** completion routed through the **Kilo Gateway**. It analyzes the code before and after your cursor to generate contextually accurate inline suggestions.

You can choose between two FIM models:

- **Codestral** (`mistralai/codestral-2508`) by Mistral AI — the default, billed through your Kilo account.
- **Mercury Edit 2** (`inception/mercury-edit-2`) by Inception — temporarily available via **BYOK** (Bring Your Own Key) only; Kilo Gateway support is coming soon.

## Triggering Options

### Auto-trigger

Autocomplete is **enabled by default** and automatically shows inline suggestions as you type. Suggestions appear as ghost text that you can accept with `Tab`.

### Trigger on keybinding (Cmd+L)

Press `Cmd+L` (Mac) or `Ctrl+L` (Windows/Linux) to manually request a completion at your cursor position.

{% callout type="note" %}
This keybinding requires `kilo-code.new.autocomplete.enableSmartInlineTaskKeybinding` to be enabled in VS Code settings. It is **disabled by default**.
{% /callout %}

## Provider and Model

Autocomplete requests are routed through the **Kilo Gateway**. You can pick the FIM model under **Settings → Models → Autocomplete model**:

- **Codestral** (`mistralai/codestral-2508`) — the default. Billed through your Kilo account, or free when you add your own Mistral Codestral key via BYOK. See [Setting Up Mistral for Free Autocomplete](/docs/code-with-ai/features/autocomplete/mistral-setup).
- **Mercury Edit 2** (`inception/mercury-edit-2`) — a fast diffusion-based FIM model by Inception. Temporarily requires an **Inception BYOK key** until Kilo Gateway support lands. Add one from the [BYOK page](https://app.kilo.ai/byok) in the Kilo platform. See [Bring Your Own Key (BYOK)](/docs/getting-started/byok) for setup details.

{% callout type="note" %}
Mercury Edit 2 is only available through BYOK for now — Kilo Gateway support is coming soon. If you select Mercury Edit 2 without a valid Inception BYOK key configured, autocomplete requests will fail — switch back to Codestral or add an Inception key to continue.
{% /callout %}

## Status Bar

The extension displays an **autocomplete status indicator** in the VS Code status bar, including:

- Current autocomplete state (active/snoozed)
- Cumulative cost tracking for autocomplete requests

### Snooze / Unsnooze

You can temporarily disable autocomplete by clicking the status bar item to **snooze** it. Click again to **unsnooze** and re-enable suggestions.

## Copilot Conflict Detection

The extension automatically detects if **GitHub Copilot** inline suggestions are enabled and warns you about potential conflicts. Disable Copilot's inline completions for the best experience with Kilo Code autocomplete.

## Best Practices

1. **Use Manual Autocomplete for precision**: When you need suggestions at specific moments, use the keyboard shortcut rather than relying on auto-trigger
2. **Use chat for complex changes**: Chat is better suited for multi-file changes and substantial code modifications
3. **Steer autocomplete with comments**: Write a comment describing what you want before triggering autocomplete, or type a function signature — autocomplete will fill in the implementation

4. **Check the status bar tooltip**: Hover the status bar item to see autocomplete state and cost tracking

## Tips

{% callout type="tip" %}
**When to use chat vs autocomplete:** Use chat for multi-file changes, refactoring, or when you need to explain intent. Use autocomplete for quick, localized edits where the context is already clear from surrounding code.
{% /callout %}

{% callout type="tip" %}
**Treat suggestions as drafts:** Accept autocomplete suggestions quickly, then refine. It's often faster to fix a 90% correct suggestion than to craft the perfect prompt.
{% /callout %}

- Autocomplete works best with clear, well-structured code
- Comments above functions help autocomplete understand intent
- Variable and function names matter — descriptive names lead to better suggestions

## Related Features

- [Code Actions](/docs/code-with-ai/features/code-actions) - Context menu options for common coding tasks
