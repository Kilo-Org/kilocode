---
title: "Autocomplete"
description: "AI-powered code autocompletion in Kilo Code"
---

# Autocomplete

Kilo Code's autocomplete feature provides intelligent code suggestions and completions while you're typing, helping you write code faster and more efficiently. It offers both automatic and manual triggering options.

{% tabs %}
{% tab label="VSCode" %}

## Autocomplete

Kilo Code's standard autocomplete uses Fill-in-the-Middle (FIM) completion. It analyzes the code before and after your cursor, then suggests a completion as ghost text that you can accept with `Tab`.

Available autocomplete models:

- **Codestral** (`mistralai/codestral-2508`) by Mistral AI — the default model.
- **Mercury Edit 2** (`inception/mercury-edit-2`) by Inception — fast diffusion-based FIM completion.

## Next Edit

Next Edit predicts multi-line edits and provides a jump-to-edit workflow.

- **Mercury Next Edit** (`inception/mercury-next-edit`) by Inception — the only model option that supports Next Edit.

Mercury Next Edit uses a separate edit-completions pipeline powered by Inception's Mercury Edit 2 model. Selecting **Mercury Edit 2** directly enables FIM autocomplete, not Next Edit.

## Triggering Options

### Auto-trigger

Autocomplete is **enabled by default** and automatically shows inline suggestions as you type.

### Trigger on keybinding (Cmd+L)

Press `Cmd+L` (Mac) or `Ctrl+L` (Windows/Linux) to manually request a completion at your cursor position.

{% callout type="note" %}
This keybinding requires `kilo-code.new.autocomplete.enableSmartInlineTaskKeybinding` to be enabled in VS Code settings. It is **disabled by default**.
{% /callout %}

## Provider Routing and BYOK

Requests use the **Kilo Gateway** by default. All three model options are available with Kilo Gateway selected.

Keys saved on the Kilo [BYOK page](https://app.kilo.ai/byok) are Gateway BYOK keys. Keep **Kilo Gateway** selected, and the Gateway automatically uses a matching organization key when you are working in an organization context or a matching personal key otherwise. Without a matching Gateway BYOK key, requests are billed through your Kilo account.

A Codestral BYOK key can use Mistral's free tier. See [Setting Up Mistral for Free Autocomplete](/docs/code-with-ai/features/autocomplete/mistral-setup).

To bypass Kilo Gateway, connect a Mistral or Inception provider API key in Kilo Code and choose the matching model under that provider in **Settings → Models**. Direct-provider requests go straight from your local Kilo backend to the provider and do not use Kilo credits.

{% callout type="note" %}
**Mercury Next Edit and organization privacy settings:** Mercury Next Edit is unavailable through Kilo Gateway when your organization denies provider data collection, because Inception's standard edit endpoint does not provide a per-request opt-out.
{% /callout %}

## Status Bar

The extension displays an **autocomplete status indicator** in the VS Code status bar, including:

- Current autocomplete state (active/snoozed)
- Kilo balance cost tracking for requests billed through Kilo Gateway

### Snooze / Unsnooze

You can temporarily disable autocomplete by clicking the status bar item to **snooze** it. Click again to **unsnooze** and re-enable suggestions.

## Copilot Conflict Detection

The extension automatically detects if **GitHub Copilot** inline suggestions are enabled and warns you about potential conflicts. Disable Copilot's inline completions for the best experience with Kilo Code autocomplete.

{% /tab %}
{% tab label="VSCode (Legacy)" %}

## How Autocomplete Works

Autocomplete analyzes your code context and provides:

- **Inline completions** as you type
- **Quick fixes** for common code patterns
- **Contextual suggestions** based on your surrounding code
- **Multi-line completions** for complex code structures

## Triggering Options

### Code Editor Suggestions

#### Auto-trigger suggestions

When enabled, Kilo Code automatically shows inline suggestions when you pause typing. This provides a seamless coding experience where suggestions appear naturally as you work.

- **Auto Trigger Delay**: Configure the delay (in seconds) before suggestions appear after you stop typing
- Default is 3 seconds, but this can be adjusted up or down
- Shorter delays mean quicker suggestions but may be more resource-intensive

#### Trigger on keybinding (Cmd+L)

For more control over when suggestions appear:

1. Position your cursor where you need assistance
2. Press `Cmd+L` (Mac) or `Ctrl+L` (Windows/Linux)
3. Kilo Code analyzes the surrounding context
4. Receive immediate improvements or completions

This is ideal for:

- Quick fixes
- Code completions
- Refactoring suggestions
- Keeping you in the flow without interruptions

You can customize this keyboard shortcut as well in your VS Code settings.

### Chat Suggestions

#### Enable Chat Autocomplete

When enabled, Kilo Code will suggest completions as you type in the chat input. Press Tab to accept suggestions.

## Provider and Model Selection

Autocomplete currently uses **Codestral** (by Mistral AI) as the underlying model. This model is specifically optimized for code completion tasks and provides fast, high-quality suggestions.

### How the Provider is Chosen

Kilo Code automatically selects a provider for autocomplete in the following priority order:

- **Mistral** (using `codestral-latest`)
- **Kilo Code** (using `mistralai/codestral-2508`)
- **OpenRouter** (using `mistralai/codestral-2508`)
- **Requesty** (using `mistral/codestral-latest`)
- **Bedrock** (using `mistral.codestral-2508-v1:0`)
- **Hugging Face** (using `mistralai/Codestral-22B-v0.1`)
- **LiteLLM** (using `codestral/codestral-latest`)
- **LM Studio** (using `mistralai/codestral-22b-v0.1`)
- **Ollama** (using `codestral:latest`)

{% callout type="note" %}
**Model Selection is Currently Fixed**: At this time, you cannot freely choose a different model for autocomplete. The feature is designed to work specifically with Codestral, which is optimized for Fill-in-the-Middle (FIM) completions. Support for additional models may be added in future releases.
{% /callout %}

## Disable Rival Autocomplete

We recommend disabling rival autocompletes to optimize your experience with Kilo Code. To disable GitHub Copilot autocomplete in VSCode, go to **Settings** and navigate to **GitHub** > **Copilot: Advanced** (or search for 'copilot').

Then, toggle to 'disabled':

{% image src="https://github.com/user-attachments/assets/60c69417-1d1c-4a48-9820-5390c30ae25c" alt="Disable GitHub Copilot in VSCode" width="800" caption="Disable GitHub Copilot in VSCode" /%}

If using Cursor, go to **Settings** > **Cursor Settings** > **Tab**, and toggle off 'Cursor Tab':

{% image src="https://github.com/user-attachments/assets/fd2eeae2-f770-40ca-8a72-a9d5a1c17d47" alt="Disable Cursor autocomplete" width="800" caption="Disable Cursor autocomplete" /%}

{% /tab %}
{% /tabs %}

## Best Practices

1. **Use Manual Autocomplete for precision**: When you need suggestions at specific moments, use the keyboard shortcut rather than relying on auto-trigger
2. **Use chat for complex changes**: Chat is better suited for multi-file changes and substantial code modifications
3. **Steer autocomplete with comments**: Write a comment describing what you want before triggering autocomplete, or type a function signature — autocomplete will fill in the implementation

{% tabs %}
{% tab label="VSCode" %}

4. **Check the status bar tooltip**: Hover the status bar item to see autocomplete state and cost tracking

{% /tab %}
{% tab label="VSCode (Legacy)" %}

4. **Balance speed and quality**: Faster models provide quicker suggestions but may be less accurate
5. **Adjust trigger delay**: Find the sweet spot between responsiveness and avoiding too many API calls
6. **Configure providers wisely**: Consider using faster, cheaper models for autocomplete while keeping more powerful models for chat

{% /tab %}
{% /tabs %}

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
