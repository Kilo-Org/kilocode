---
title: "Using Kunavo with Kilo Code | Unified AI Gateway"
description: "Access Claude, Gemini, GPT and image/video/audio models through Kunavo in Kilo Code — one OpenAI-compatible key, transparent per-token pricing 30–70% under list."
sidebar_label: Kunavo
---

# Using Kunavo With Kilo Code

[Kunavo](https://kunavo.com) is a unified AI gateway: one OpenAI-compatible API and one prepaid wallet for Anthropic Claude, Google Gemini, OpenAI GPT and image/video/audio models. Every model shows a transparent per-token USD price next to the provider's official rate (typically 30–70% under list), failed requests are never billed, and the native Anthropic Messages API is available on the same key.

## Getting Started

1. **Sign up for Kunavo:** Visit [kunavo.com](https://kunavo.com/app/signup) to create an account and top up from $5 (the balance never expires).
2. **Get your API key:** Create a key at **Dashboard → API Keys**. It is shown once at creation, so copy it straight away.
3. **Configure in Kilo Code:** Add the base URL and key to Kilo Code settings.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab. Select **OpenAI Compatible** and configure:

- **Base URL**: `https://api.kunavo.com/v1`
- **API Key**: your Kunavo API key
- **Model**: e.g. `claude-opus-5`, `claude-sonnet-4-6` or `gemini-2-5-flash`

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export KUNAVO_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "kunavo": {
      "env": ["KUNAVO_API_KEY"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "kunavo/anthropic/claude-opus-5",
}
```

{% /tab %}
{% /tabs %}

## Supported Models

| Model | Best for | Price (in/out per 1M) |
| --- | --- | --- |
| `claude-opus-5` | Hardest refactors and agents, 1M context | $2.00 / $10.00 |
| `claude-sonnet-5` | Near-Opus coding at Sonnet cost | $2.10 / $10.50 |
| `claude-sonnet-4-6` | Everyday workhorse | $1.20 / $6.00 |
| `claude-haiku-4-5` | Cheap high-volume steps | $0.40 / $2.00 |
| `gemini-3-6-flash` | Thinking-by-default at Flash latency | $1.05 / $5.25 |
| `gemini-2-5-flash` | Fastest/cheapest quick asks | $0.09 / $0.75 |
| `gpt-5-6-sol` | OpenAI's newest flagship, 1.05M context | $2.00 / $12.00 |

`claude-opus-5` is the pick worth knowing about: it is both stronger and slightly cheaper per token than `claude-sonnet-5` here.

Visit [kunavo.com/models](https://kunavo.com/models) for the complete list with live prices.

## API Compatibility

Kunavo implements the OpenAI chat completions contract, so Kilo Code's **OpenAI Compatible** provider works without any adapter. Claude models are additionally reachable on the native Anthropic Messages API at the origin `https://api.kunavo.com` (the client appends `/v1/messages` itself) — that route passes `cache_control` through untranslated, so prompt caching bills cached input at 10% of the input rate.

Model IDs are matched exactly and are not aliased, so date-suffixed names such as `claude-sonnet-4-5-20250929` will not resolve — use the plain slug.

## Tips

- Set `KUNAVO_API_KEY` in your shell for the CLI; the extension stores the key in its own settings.
- A typical 20-step agentic session on `claude-sonnet-4-6` costs roughly $0.74 at Kunavo rates. See the [cost calculator](https://kunavo.com/guides/llm-api-cost-calculator).
- Full setup guide: [Kilo Code + Claude API](https://kunavo.com/guides/kilo-code-claude-api). The same three fields work in the sibling extensions — [Cline](https://kunavo.com/guides/cline-claude-api) and [Roo Code](https://kunavo.com/guides/roo-code-claude-api).
