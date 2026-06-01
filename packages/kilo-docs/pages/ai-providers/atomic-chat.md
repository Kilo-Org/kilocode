---
title: "Using Atomic Chat with Kilo Code | Local LLMs"
description: "Run local models in Kilo Code via Atomic Chat's OpenAI-compatible API. Setup for VS Code and the CLI."
sidebar_label: Atomic Chat
---

# Using Atomic Chat With Kilo Code

[Kilo Code](https://kilocode.ai/) supports [Atomic Chat](https://atomic.chat/) as a local provider. Atomic Chat runs models on your machine and exposes an OpenAI-compatible API (default `http://127.0.0.1:1337/v1`).

**Website:** [https://atomic.chat/](https://atomic.chat/)  
**Repository:** [https://github.com/AtomicBot-ai/Atomic-Chat](https://github.com/AtomicBot-ai/Atomic-Chat)

## Prerequisites

1. Install [Atomic Chat](https://atomic.chat/) (macOS or Windows).
2. Download and load a model in the app.
3. Enable the **local API server** (default port **1337**).
4. Confirm the API responds:

```bash
curl http://127.0.0.1:1337/v1/models
```

## Configuration in Kilo Code

Kilo Code ships the `@kilocode/plugin-atomic-chat` plugin by default. It **does not** call localhost unless you opt in (see below). When enabled, it discovers models from `GET /v1/models` and can warn if the selected model is not loaded.

**Localhost HTTP runs only when one of these is true:**

- You configure `provider.atomic-chat` in `kilo.jsonc`
- You set `"model": "atomic-chat/..."` (or per-agent model uses `atomic-chat`)
- You enable optional auto-detect: `"atomicChat": { "autoDetect": true }` (probes ports **1337** and **1338**)

Otherwise no requests are made to Atomic Chat (suitable for restricted environments).

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) → **Providers** → **Atomic Chat**. No API key is required for the default local server. Adjust the base URL if Atomic Chat uses a non-default host or port.

{% /tab %}
{% tab label="CLI" %}

**Config file** (`~/.config/kilo/kilo.jsonc` or `./kilo.jsonc`):

```jsonc
{
  "provider": {
    "atomic-chat": {
      "options": {
        "baseURL": "http://127.0.0.1:1337/v1",
      },
    },
  },
}
```

Set your default model (use an id from `curl http://127.0.0.1:1337/v1/models`):

```jsonc
{
  "model": "atomic-chat/gemma-4-E4B-it-IQ4_XS",
}
```

Optional auto-detect without a provider block:

```jsonc
{
  "atomicChat": { "autoDetect": true },
}
```

To disable the provider entirely, use `disabled_providers: ["atomic-chat"]` or remove `@kilocode/plugin-atomic-chat` from the `plugin` array in your config.

{% /tab %}
{% /tabs %}

## Custom or unlisted models

If a loaded model does not appear in the picker, register it under `provider.atomic-chat.models`:

```jsonc
{
  "model": "atomic-chat/my-local-model",
  "provider": {
    "atomic-chat": {
      "models": {
        "my-local-model": {
          "id": "exact-id-from-v1-models",
          "name": "My Local Model",
        },
      },
    },
  },
}
```

See [Custom Models](/docs/code-with-ai/agents/custom-models) for all model fields.

## Tips

- Prefer capable models with large context windows; agent workflows use long prompts.
- Keep only the models you need loaded in Atomic Chat to save memory.
- For embeddings via Atomic Chat, use the **openai-compatible** indexing provider with the same base URL.

## Related

- [LM Studio](/docs/ai-providers/lmstudio)
- [Ollama](/docs/ai-providers/ollama)
- [Local models overview](/docs/automate/extending/local-models)
