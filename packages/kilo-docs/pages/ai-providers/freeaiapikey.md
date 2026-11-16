---
title: "Using FreeAIapikey with Kilo Code"
description: "Connect Kilo Code to FreeAIapikey's OpenAI-compatible gateway with an API key and a live model ID."
sidebar_label: FreeAIapikey
---

# Using FreeAIapikey With Kilo Code

[FreeAIapikey](https://freeaiapikey.com) is an AI gateway with one-key access to Claude, GPT and more. Kilo Code uses the `freeaiapikey` provider ID and reads your API key from `FREEAIKEY_API_KEY`.

{% callout type="note" %}
The FreeAIapikey provider entry in Kilo Code's catalog is sourced from [models.dev](https://models.dev). If it does not yet appear in your provider list, the catalog entry may still be pending merge — you can also connect via the OpenAI Compatible provider with base URL `https://api.freeaiapikey.com/v1` in the meantime.
{% /callout %}

## Before you begin

1. Create an account at [freeaiapikey.com](https://freeaiapikey.com) ($2 free credit, no card required).
2. Create an API key in your [FreeAIapikey dashboard](https://freeaiapikey.com/dashboard).
3. Choose an exact model ID from the live catalog. Model availability and pricing can change, so check `GET https://api.freeaiapikey.com/v1/models` instead of copying an old model list.


## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** in the Kilo Code extension.
2. Go to the **Providers** tab and add **FreeAIapikey**. If it is not visible, click **Show more providers**.
3. Enter your FreeAIapikey API key.
4. Select a model available to your account, e.g. `openai/gpt-6-sol`.

The provider credentials are stored in Kilo's `auth.json` store.

{% /tab %}
{% tab label="CLI" %}

**Recommended:** connect interactively so the API key is stored in Kilo's `auth.json` store (same credential store as VS Code).

1. In the TUI, run `/connect` and choose **FreeAIapikey**, then paste your API key.
2. Or from the shell:

```bash
kilo auth login --provider freeaiapikey
```

Then pick a model from the model picker, or set a default model using the `provider-id/model-id` format:

```jsonc
{
  "model": "freeaiapikey/openai/gpt-6-sol",
}
```

{% /tab %}
{% /tabs %}

## Verify the connection

```bash
curl https://api.freeaiapikey.com/v1/models -H "Authorization: Bearer $FREEAIKEY_API_KEY"
```

If the catalog returns your model, the connection is working.

{% callout type="note" %}
This documentation was contributed by FreeAIapikey, the provider it describes.
{% /callout %}
