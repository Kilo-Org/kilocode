---
title: "Using Obscurify.ai with Kilo Code"
description: "Connect Kilo Code to Obscurify.ai's OpenAI-compatible API with an API key."
sidebar_label: Obscurify.ai
---

# Using Obscurify.ai With Kilo Code

[Obscurify.ai](https://obscurify.ai/?utm_source=kilocode) is a privacy-focused AI service with an OpenAI-compatible API. Accounts are a random account number, with no email required. Kilo Code uses the `obscurify` provider ID and reads your API key from `OBSCURIFY_API_KEY`.

## Before you begin

1. Create an account at [obscurify.ai/signup](https://obscurify.ai/signup) and add credit on the account page. The API works on any plan while the balance is positive.
2. On the account page, click **Show API Key** and copy the key.

## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** in the Kilo Code extension.
2. Go to the **Providers** tab and add **Obscurify.ai**. If it is not visible, click **Show more providers**.
3. Enter your API key.
4. Select a model.

The provider credentials are stored in Kilo's `auth.json` store.

{% /tab %}
{% tab label="CLI" %}

Connect interactively so the API key is stored in Kilo's `auth.json` store (the same credential store as VS Code):

1. In the TUI, run `/connect` and choose **Obscurify.ai**, then paste your API key.
2. Or from the shell:

```bash
kilo auth login --provider obscurify
```

Then pick a model from the model picker, or set a default model. Model IDs keep the lab prefix after the provider ID:

```jsonc
{
  "model": "obscurify/deepseek/deepseek-v4-flash",
}
```

**Manual configuration (optional):** set the key in the environment instead of storing it:

```bash
export OBSCURIFY_API_KEY="your-api-key"
```

{% /tab %}
{% /tabs %}

## Models not in the picker

The model picker lists the Obscurify.ai models in Kilo's provider catalog. The full model list is at `https://obscurify.ai/v1/models`, with prices on the [model cards](https://obscurify.ai/models) page. To use a model that is not in the picker, add its ID to `~/.config/kilo/kilo.json` or `./kilo.json` with a name and limits:

```jsonc
{
  "provider": {
    "obscurify": {
      "models": {
        "qwen/qwen3-coder-next": {
          "name": "Qwen3 Coder Next",
          "limit": { "context": 262144, "output": 65536 },
        },
      },
    },
  },
}
```

Take `context` from the model's `context_length` in `/v1/models`, and `output` from the model's own documentation. Without `limit`, both default to `0`, which turns off automatic compaction for that model. Kilo shows a cost of $0 for a model added this way.

## API compatibility

Kilo Code connects to Obscurify.ai through the OpenAI-compatible chat completions API at `https://obscurify.ai/v1`. The full API reference is at [obscurify.ai/api-docs](https://obscurify.ai/api-docs).

## Troubleshooting

- **Invalid API key:** Copy the key again from the account page, then reconnect with `/connect` or `kilo auth login --provider obscurify`, or update `OBSCURIFY_API_KEY`.
- **Requests stop working:** Check the balance on the account page. Requests fail once it runs out.
- **Model not found:** Copy the exact model ID from `https://obscurify.ai/v1/models`, including the lab prefix, such as `deepseek/`.

{% callout type="note" %}
This documentation was contributed by the Obscurify.ai team.
{% /callout %}
