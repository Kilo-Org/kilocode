---
title: "Using nokeep with Kilo Code | Private OpenAI-Compatible API"
description: "Connect nokeep's private, OpenAI-compatible chat API to Kilo Code. Setup guide for VS Code and the CLI, with the DeepSeek and GLM models it serves."
---

# Using nokeep With Kilo Code

nokeep is a private chat API that serves lower-refusal fine-tunes of DeepSeek V4.1 Flash and GLM-5.3-Flash. It doesn't store prompts or replies. The API is OpenAI-compatible, supports streaming, tool calls and reasoning effort, and bills from prepaid credits with no subscription.

**Website:** [https://nokeep.ai/](https://nokeep.ai/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to the [nokeep console](https://nokeep.ai/console) and create an account or sign in.
2. **Add Credits:** The API is pay as you go. Add credits from the console before your first call.
3. **Create a Key:** Create a key, give it a descriptive name (e.g., "Kilo Code"), and copy it. Keys start with `sk-nokeep-`.

## Configuration in Kilo Code

nokeep is a **built-in provider** in Kilo Code, so you can connect it directly with no custom provider setup.

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Click **Connect provider**, search for **nokeep**, and select it.
3. Enter your nokeep API key.
4. Pick a model from the list.

{% /tab %}
{% tab label="CLI" %}

**Method 1: `/connect` (recommended)**

Run `kilo`, then use the `/connect` command, select **nokeep**, and paste your API key when prompted:

```bash
kilo
# then, inside Kilo, run:
/connect
```

**Method 2: config file**

Set your API key and add nokeep in your `kilo.json` config file (`~/.config/kilo/kilo.json` or `./kilo.json`):

```bash
export NOKEEP_API_KEY="your-api-key"
```

```jsonc
{
  "provider": {
    "nokeep": {
      "env": ["NOKEEP_API_KEY"],
    },
  },
  "model": "nokeep/deepseek-v4.1-flash-uncensored",
}
```

{% /tab %}
{% /tabs %}

## Models

- `deepseek-v4.1-flash-uncensored`: 1M context, 131K max output, reads images. This ID follows the newest build.
- `deepseek-v4.1-flash-1017-uncensored`: the same model pinned to the 17 October 2026 build.
- `glm-5.3-flash-uncensored`: 128K context, 32K max output, text only.

See the [nokeep model docs](https://nokeep.ai/docs/models) for the current list and limits.

## Tips and Notes

- **Model list:** The picker comes from the [models.dev](https://models.dev/providers/nokeep) catalog. To see what the API serves right now, check `https://nokeep.ai/v1/models`, which needs no key.
- **Reasoning:** DeepSeek takes `reasoning_effort` `none`, `low`, `high` or `max` and answers without reasoning when no effort is set. GLM always reasons and takes `low` or `high`. See [Thinking](https://nokeep.ai/docs/thinking).
- **Tool calls:** DeepSeek takes every `tool_choice`. GLM takes `auto` or `none`.
- **Pricing:** See [nokeep pricing](https://nokeep.ai/docs/pricing) for current per-token prices, cached input included.

## Troubleshooting

- **Invalid API key:** Check that `NOKEEP_API_KEY` is set in the same environment that launches Kilo, or reconnect the provider in Settings.
- **Out of credits:** A call that the account's credits can't cover returns `402 insufficient_credits`. Add credits in the [console](https://nokeep.ai/console).
- **Images refused:** GLM reads text only. Send images to a DeepSeek model.
