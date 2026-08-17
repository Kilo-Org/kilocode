---
title: "Using Eden AI with Kilo Code"
description: "Configure Eden AI in Kilo Code, an EU-based OpenAI-compatible gateway, for one API key across many vendors and an EU endpoint for data residency."
sidebar_label: Eden AI
---

# Using Eden AI With Kilo Code

[Eden AI](https://www.edenai.co/) is an EU-based AI gateway that puts models from many vendors behind one OpenAI-compatible API. It is worth a look if you want a single key and a single invoice across vendors, or an EU endpoint for data-residency requirements. Kilo Code uses the `edenai` provider ID and reads your API key from `EDENAI_API_KEY`.

## Before you begin

1. Create an account at [edenai.co](https://www.edenai.co/).
2. Create an API key in your Eden AI account settings.
3. Pick a model ID. The live catalogue, with pricing, context sizes and capabilities, is public and needs no authentication at [api.edenai.run/v3/models](https://api.edenai.run/v3/models). Availability and pricing change, so read the catalogue rather than copying an old model list.

## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** in the Kilo Code extension.
2. Go to the **Providers** tab and add **Eden AI**. If it is not visible, click **Show more providers**.
3. Enter your Eden AI API key.
4. Select a model.

The provider credentials are stored in Kilo's `auth.json` store.

{% /tab %}
{% tab label="CLI" %}

**Recommended:** connect interactively so the API key is stored in Kilo's `auth.json` store, the same credential store the VS Code extension uses.

1. In the TUI, run `/connect`, choose **Eden AI**, then paste your API key.
2. Or from the shell:

```bash
kilo auth login --provider edenai
```

Then pick a model from the model picker, or set a default model in `provider-id/model-id` form:

```jsonc
{
  "model": "edenai/anthropic/claude-sonnet-5",
}
```

**Manual configuration (optional):** keep the key in the environment and declare the provider in `~/.config/kilo/kilo.json` or `./kilo.json`, so the secret never lands in the project file:

```bash
export EDENAI_API_KEY="your-api-key"
```

```jsonc
{
  "provider": {
    "edenai": {
      "env": ["EDENAI_API_KEY"],
    },
  },
  "model": "edenai/anthropic/claude-sonnet-5",
}
```

{% /tab %}
{% /tabs %}

## Model naming

Eden AI model IDs are themselves in `vendor/model` form, so a full reference in Kilo has three segments: `edenai/<vendor>/<model>`. For example:

```jsonc
{
  "model": "edenai/openai/gpt-4o-mini",
}
```

```jsonc
{
  "model": "edenai/google/gemini-3.6-flash",
}
```

```jsonc
{
  "model": "edenai/zai/glm-5.2",
}
```

## Using a model that is not in the picker

The model picker lists the Eden AI models published in the catalogue Kilo refreshes. The Eden AI catalogue is considerably larger, and any model in it can be used by declaring it yourself, as described in [Custom Models](/docs/code-with-ai/agents/custom-models):

```jsonc
{
  "provider": {
    "edenai": {
      "models": {
        "anthropic/claude-haiku-4-5": {
          "name": "Claude Haiku 4.5",
          "cost": { "input": 1, "output": 5, "cache_read": 0.1 },
        },
      },
    },
  },
  "model": "edenai/anthropic/claude-haiku-4-5",
}
```

Use the identifier exactly as it appears in the [models endpoint](https://api.edenai.run/v3/models). Eden AI passes it through to the underlying vendor, and a model declared this way inherits the Eden AI API base and protocol, so nothing else needs configuring.

Declare `cost` as shown, and `limit` too if you want the context gauge to be right. Kilo defaults both to zero for a model it does not already know, which would leave spend reporting at zero. Costs are per million tokens, so multiply the endpoint's `input_cost_per_token` and `output_cost_per_token` by one million. A `limit` block needs both `context`, from the endpoint's `context_length`, and `output`.

## EU data residency

Eden AI runs a separate EU gateway for teams with data-residency requirements. Point the provider at it with a custom base URL:

```jsonc
{
  "provider": {
    "edenai": {
      "env": ["EDENAI_API_KEY"],
      "options": {
        "baseURL": "https://api.eu.edenai.run/v3",
      },
    },
  },
}
```

That base URL governs where Eden AI itself processes the request. Independently of it, some models are also published as a region-pinned variant that pins the underlying vendor's region, marked with an `@eu` suffix:

```jsonc
{
  "model": "edenai/vertex/gemini-3.6-flash@eu",
}
```

Only a few of these variants appear in the picker. If the one you need is missing, declare it as shown in the previous section.

## Cost tracking

The spend Kilo Code shows for Eden AI is derived from token counts and the per-model rates in the catalog, so treat it as an estimate. Eden AI returns the actual cost of each request in its own response body, and that figure, together with your Eden AI dashboard, is the authoritative one.

If you declared a model yourself as shown above, set `cost` on it. Kilo Code has no catalog rates for a model it does not already know, so its estimate would otherwise stay at zero. The catalog carries cache-read rates where the underlying model supports prompt caching, so the estimate accounts for caching on the models it does know.

## Troubleshooting

- **Invalid API key:** create a new key in your Eden AI account, then reconnect with `/connect` or `kilo auth login --provider edenai`, or update `EDENAI_API_KEY` if you use manual configuration.
- **Model not found:** copy the identifier exactly as the [models endpoint](https://api.edenai.run/v3/models) returns it, including the vendor prefix. Do not rely on a static model list.
- **Model missing from the picker:** declare it under `provider.edenai.models` as shown above.
- **Provider not visible:** refresh Kilo Code's provider catalogue, then check **Show more providers**.
- **A key or model you just added has no effect:** Kilo caches the resolved catalogue for a few minutes. Wait, then restart your client.

{% callout type="note" %}
This documentation was contributed by Eden AI, the provider it describes.
{% /callout %}
