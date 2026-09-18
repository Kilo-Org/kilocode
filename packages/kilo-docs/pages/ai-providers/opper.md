---
title: "Using Opper with Kilo Code"
description: "Route AI model requests through Opper in Kilo Code for access to 700+ models from 30+ providers through one EU-hosted, OpenAI-compatible API."
sidebar_label: Opper
---

# Using Opper With Kilo Code

Kilo Code supports accessing models through the [Opper](https://opper.ai/) AI gateway. Opper is a European AI gateway serving 700+ models from 30+ providers, including Claude, GPT, Gemini, Grok, Mistral and leading open-weight models, through one API key, hosted in the EU.

**Website:** [https://opper.ai/](https://opper.ai/)

## Getting an API Key

1.  **Sign Up/Sign In:** Go to [platform.opper.ai](https://platform.opper.ai/) and create an account or sign in.
2.  **Get API Key:** Create an API key from the API Keys section of the Opper platform.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) inside the Kilo Code extension and go to the **Providers** tab to add Opper and enter your API key. If you don't see Opper listed, click **Show more providers**.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export OPPER_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "opper": {
      "env": ["OPPER_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "opper/anthropic/claude-sonnet-4-6",
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **EU hosting and data residency:** Opper runs in the EU, and every route in the [model catalogue](https://opper.ai/models) is labeled with its hosting region and data retention posture, including EU-hosted variants of frontier models.
- **Pricing:** Pay-as-you-go with no markup on provider token rates. Only the successful model response is billed; failed requests that fall back to another model are not charged.
- **Failover:** Requests fail over automatically across providers when an upstream has an outage.
- **One balance:** A single credit balance covers all 700+ models, so switching models never means new accounts or API keys.
- **Reasoning models:** `reasoning_effort` is passed through to each model's native controls, and models like Claude, Grok and MiniMax return their thinking in `reasoning_content`.

## Relevant resources

- [Opper model catalogue](https://opper.ai/models) with per-route pricing, context windows and hosting regions
- [Opper documentation](https://docs.opper.ai/)
- [Opper blog](https://opper.ai/blog)
