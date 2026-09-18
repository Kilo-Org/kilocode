---
title: "Standard Compute"
description: "Connect Standard Compute's routed model to Kilo Code using a custom provider."
sidebar_label: Standard Compute
---

# Standard Compute

Use [Standard Compute](https://standardcompute.com/) to keep working in Kilo Code while the service selects models and providers for your requests. The `standardcompute` model is a routing alias; it does not identify a single upstream model.

## Connect in VS Code

1. Get an API key from the [Standard Compute dashboard](https://standardcompute.com/dashboard).
2. Open **Settings → Providers → Custom provider**.
3. Enter these settings:

| Setting | Value |
|---|---|
| Provider ID | `standardcompute` |
| Display name | `Standard Compute` |
| Provider API | `OpenAI Compatible` |
| Base URL | `https://api.stdcmpt.com/v1` |
| API key | Your Standard Compute API key |
| Model ID | `standardcompute` |

4. Submit the provider and select **Standard Compute** in the model picker.

## Connect in the CLI

Set `STANDARDCOMPUTE_API_KEY` in the shell where you run Kilo. Add this provider to `~/.config/kilo/kilo.json`; merge the entry into your existing `provider` object if you already have other providers configured.

```json
{
  "provider": {
    "standardcompute": {
      "npm": "@ai-sdk/openai-compatible",
      "env": ["STANDARDCOMPUTE_API_KEY"],
      "models": {
        "standardcompute": {
          "name": "Standard Compute",
          "limit": {
            "context": 1000000,
            "output": 4096
          }
        }
      },
      "options": {
        "baseURL": "https://api.stdcmpt.com/v1"
      }
    }
  }
}
```

The context limit follows the provider's [models.dev entry](https://github.com/anomalyco/models.dev/blob/dev/providers/standardcompute/models/standardcompute.toml). This example uses a conservative 4,096-token output limit; adjust it to the limit available on your plan when you need longer responses.

Select the model for a single command:

```bash
kilo run --model standardcompute/standardcompute "Explain the structure of this project."
```

For additional settings, see [OpenAI-compatible providers](/docs/ai-providers/openai-compatible). Standard Compute usage is billed by Standard Compute; see its [current plans](https://standardcompute.com/pricing).
