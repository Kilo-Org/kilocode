---
title: "Using Anthropic Claude with Kilo Code"
description: "Configure Anthropic's Claude models in Kilo Code. Guide to getting an API key, setting up Claude Sonnet and Opus in VS Code and the CLI."
sidebar_label: Anthropic
---

# Using Anthropic With Kilo Code

Anthropic is an AI safety and research company that builds reliable, interpretable, and steerable AI systems. Their Claude models are known for their strong reasoning abilities, helpfulness, and honesty.

**Website:** [https://www.anthropic.com/](https://www.anthropic.com/)

## Getting an API Key

1.  **Sign Up/Sign In:** Go to the [Anthropic Console](https://console.anthropic.com/). Create an account or sign in.
2.  **Navigate to API Keys:** Go to the [API keys](https://console.anthropic.com/settings/keys) section.
3.  **Create a Key:** Click "Create Key". Give your key a descriptive name (e.g., "Kilo Code").
4.  **Copy the Key:** **Important:** Copy the API key _immediately_. You will not be able to see it again. Store it securely.

## Using a Claude Max or Team subscription

If you have a Claude Max or Team plan, your subscription includes monthly Claude Platform API credits — $100/month on Max 5x, $200/month on Max 20x, and up to $500/month pooled on Team — that work with any Claude model in third-party tools like Kilo Code:

1. Link a Claude Console organization to your plan from [claude.ai Settings → Billing](https://claude.ai/settings/billing) to claim the credits.
2. Create an API key in the linked organization at [platform.claude.com](https://platform.claude.com).
3. Configure that key in Kilo Code as described above — requests draw from your subscription's monthly credits before any purchased credits.

See [Anthropic's announcement](https://x.com/claudedevs/status/2107895957933408429) and the official [Monthly API credits for Max and Team plans](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans) documentation for eligibility and full terms. Free, Pro, and Enterprise plans are not eligible.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Anthropic and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export ANTHROPIC_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "anthropic": {
      "env": ["ANTHROPIC_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "anthropic/claude-sonnet-4-20250514",
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Prompt Caching:** Claude 3 models support [prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching), which can significantly reduce costs and latency for repeated prompts.
- **Context Window:** Claude models have large context windows (200,000 tokens), allowing you to include a significant amount of code and context in your prompts.
- **Pricing:** Refer to the [Anthropic Pricing](https://www.anthropic.com/pricing) page for the latest pricing information.
- **Rate Limits:** Anthropic has strict rate limits based on [usage tiers](https://docs.anthropic.com/en/api/rate-limits#requirements-to-advance-tier). If you're repeatedly hitting rate limits, consider contacting Anthropic sales or accessing Claude through a different provider like [OpenRouter](/docs/ai-providers/openrouter) or [Requesty](/docs/ai-providers/requesty).
