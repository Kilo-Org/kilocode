---
title: "Autocomplete"
description: "AI-powered code autocompletion in Kilo Code"
---

# Autocomplete

Kilo Code's autocomplete feature provides intelligent code suggestions and completions while you're typing, helping you write code faster and more efficiently. It offers both automatic and manual triggering options.

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

## Best Practices

1. **Balance speed and quality**: Faster models provide quicker suggestions but may be less accurate
2. **Adjust trigger delay**: Find the sweet spot between responsiveness and avoiding too many API calls
3. **Use Quick Task for complex changes**: It's designed for more substantial code modifications
4. **Use Manual Autocomplete for precision**: When you need suggestions at specific moments
5. **Configure providers wisely**: Consider using faster, cheaper models for autocomplete while keeping more powerful models for chat

## Tips

- Autocomplete works best with clear, well-structured code
- Comments above functions help autocomplete understand intent
- Variable and function names matter - descriptive names lead to better suggestions

## Related Features

- [Code Actions](/features/code-actions) - Context menu options for common coding tasks
