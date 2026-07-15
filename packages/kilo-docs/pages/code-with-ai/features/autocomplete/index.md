---
title: "Autocomplete"
description: "AI-powered code autocompletion in Kilo Code"
---

# Autocomplete

Kilo Code's autocomplete feature provides intelligent code suggestions and completions while you're typing, helping you write code faster and more efficiently. It offers both automatic and manual triggering options.

## How Autocomplete Works

The extension uses **Fill-in-the-Middle (FIM)** completion. It analyzes the code before and after your cursor to generate contextually accurate inline suggestions through Kilo Gateway or a configured BYOK provider.

You can choose between these completion models:

- **Codestral** (`mistralai/codestral-2508`) by Mistral AI — the default, billed through your Kilo account.
- **Mercury Edit 2** (`inception/mercury-edit-2`) by Inception — temporarily available via **BYOK** (Bring Your Own Key) only; Kilo Gateway support is coming soon.
- A FIM-capable model exposed by a configured OpenAI-compatible provider, including local servers such as LM Studio, llama.cpp, Ollama, or OMLX.

## Triggering Options

### Auto-trigger

Autocomplete is **enabled by default** and automatically shows inline suggestions as you type. Suggestions appear as ghost text that you can accept with `Tab`.

### Trigger on keybinding (Cmd+L)

Press `Cmd+L` (Mac) or `Ctrl+L` (Windows/Linux) to manually request a completion at your cursor position.

{% callout type="note" %}
This keybinding requires `kilo-code.new.autocomplete.enableSmartInlineTaskKeybinding` to be enabled in VS Code settings. It is **disabled by default**.
{% /callout %}

## Provider and Model

You can pick the FIM model under **Settings → Models → Autocomplete model**:

- **Codestral** (`mistralai/codestral-2508`) — the default. Billed through your Kilo account, or free when you add your own Mistral Codestral key via BYOK. See [Setting Up Mistral for Free Autocomplete](/docs/code-with-ai/features/autocomplete/mistral-setup).
- **Mercury Edit 2** (`inception/mercury-edit-2`) — a fast diffusion-based FIM model by Inception. Temporarily requires an **Inception BYOK key** until Kilo Gateway support lands. Add one from the [BYOK page](https://app.kilo.ai/byok) in the Kilo platform. See [Bring Your Own Key (BYOK)](/docs/getting-started/byok) for setup details.
- A model from any connected OpenAI-compatible provider. The server and model must implement `POST /v1/completions` with both `prompt` and `suffix`; chat-only models are not compatible.

{% callout type="note" %}
Mercury Edit 2 is only available through BYOK for now — Kilo Gateway support is coming soon. If you select Mercury Edit 2 without a valid Inception BYOK key configured, autocomplete requests will fail — switch back to Codestral or add an Inception key to continue.
{% /callout %}

### Local OpenAI-compatible setup

Use these steps with LM Studio, llama.cpp, Ollama, OMLX, or another server that implements OpenAI-compatible text completions with a `suffix` field.

1. Start the server and load a FIM-capable model. This example uses an LM Studio-compatible base URL at `http://127.0.0.1:1234/v1` and the model ID `qwen2.5-coder-1.5b`. Replace both values with those reported by your server.
2. Verify the endpoint before configuring Kilo Code:

```bash
curl --no-buffer --silent --show-error \
  http://127.0.0.1:1234/v1/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "qwen2.5-coder-1.5b",
    "prompt": "function add(a, b) {\n  return ",
    "suffix": "\n}\n",
    "max_tokens": 32,
    "temperature": 0,
    "stream": true
  }'
```

The streamed `choices[0].text` values should contain an insertion such as `a + b` without repeating the prefix or suffix. If the server requires authentication, add `-H "Authorization: Bearer $API_KEY"`.

3. Add the server as a normal provider in `~/.config/kilo/kilo.jsonc`:

```jsonc
{
  "$schema": "https://app.kilo.ai/config.json",
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio",
      "options": {
        "baseURL": "http://127.0.0.1:1234/v1"
      },
      "models": {
        "qwen2.5-coder-1.5b": {
          "name": "Qwen2.5 Coder 1.5B",
          "limit": {
            "context": 32768,
            "output": 256
          }
        }
      }
    }
  }
}
```

For a remote endpoint, add `"apiKey": "{env:MY_PROVIDER_API_KEY}"` under `options` and use an HTTPS `baseURL`. Keep credentials in the global config shown above; project-level configuration cannot resolve `{env:...}` references.

4. Reload Kilo Code, open **Settings → Models → Autocomplete model**, and select **Qwen2.5 Coder 1.5B** under **LM Studio**.
5. Open a source file, place the cursor after `return ` in the example above, and request a suggestion. Automatic suggestions appear as you type. To test manually, enable `kilo-code.new.autocomplete.enableSmartInlineTaskKeybinding` and press `Cmd+L` on macOS or `Ctrl+L` on Windows/Linux. Press `Tab` to accept the ghost text.

The same configuration shape works with a llama.cpp server at a base URL such as `http://127.0.0.1:8080/v1`, Ollama at `http://127.0.0.1:11434/v1`, or another OpenAI-compatible endpoint. Endpoint support varies by server and version, so run the `curl` check with the actual base URL and model ID first. Loopback servers do not require an API key.

{% callout type="warning" %}
OpenAI compatibility alone is not enough: the endpoint must support text completions with the `suffix` field, and the selected model must be trained for FIM. Validate this with the server's `/v1/completions` endpoint before enabling automatic suggestions.
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
