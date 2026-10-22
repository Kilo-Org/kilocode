---
title: "Using SOKKAN Router with Kilo Code"
description: "Configure SOKKAN Router in Kilo Code, a Swiss OpenAI-compatible gateway with per-request CH/EU data-location control; prompts and completions are not stored."
sidebar_label: SOKKAN Router
---

# Using SOKKAN Router With Kilo Code

[SOKKAN Router](https://router.sokkan.ch) is an OpenAI-compatible inference gateway operated by NINABOT Sàrl in Geneva, Switzerland. Every model declares the zone it runs in (Switzerland, the EU/EEA, or any region), a request can be pinned to a zone, and prompts and completions are not stored by SOKKAN. Kilo Code uses the `sokkan` provider ID and reads your API key from `SOKKAN_API_KEY`.

## Before you begin

1. Create an account and an API key at [router.sokkan.ch](https://router.sokkan.ch). Keys start with `skr_` and are shown once.
2. Pick a model ID. The live catalogue, with pricing, context sizes and the serving zone, is public and needs no authentication at [router.sokkan.ch/v1/models](https://router.sokkan.ch/v1/models). Availability and pricing change, and some models are offered as committed throughput only, so read the catalogue rather than copying an old model list.

## Configure Kilo Code

{% callout type="note" %}
The **SOKKAN Router** entry in the provider list, in `/connect` and in `kilo auth login --provider sokkan` comes from the [models.dev](https://models.dev) catalogue that Kilo Code refreshes. It appears there only once SOKKAN Router is published in that catalogue ([models.dev pull request](https://github.com/anomalyco/models.dev/pull/11031), not merged yet). Until then, use the custom-provider steps below: they work with any Kilo Code version.
{% /callout %}

{% tabs %}
{% tab label="VSCode" %}

**From the catalogue:**

1. Open **Settings** in the Kilo Code extension.
2. Go to the **Providers** tab and add **SOKKAN Router**. If it is not visible, click **Show more providers**.
3. Enter your SOKKAN API key.
4. Select a model.

**If SOKKAN Router is not listed yet:** in the **Providers** tab, add a **Custom provider** with:

- **Provider ID:** `sokkan`
- **Display name:** `SOKKAN Router`
- **Provider API:** OpenAI Compatible
- **Base URL:** `https://router.sokkan.ch/v1`
- **API key:** your SOKKAN key

Then click **Fetch models** and keep the ids you need (see [Using a model that is not in the picker](#using-a-model-that-is-not-in-the-picker) for `cost` and `limit`).

The provider credentials are stored in Kilo's `auth.json` store.

{% /tab %}
{% tab label="CLI" %}

**Recommended:** connect interactively so the API key is stored in Kilo's `auth.json` store, the same credential store the VS Code extension uses.

1. In the TUI, run `/connect`, choose **SOKKAN Router**, then paste your API key.
2. Or from the shell:

```bash
kilo auth login --provider sokkan
```

If SOKKAN Router is not in the catalogue yet, `--provider sokkan` fails with `Unknown provider "sokkan"`. Run `/connect` (or `kilo auth login` without `--provider`), choose **Other**, enter the provider id `sokkan` and paste your key. This only stores the credential: also declare the provider with its base URL as in **Manual configuration** below.

Then pick a model from the model picker, or set a default model in `provider-id/model-id` form:

```jsonc
{
  "model": "sokkan/qwen/qwen3.8-27b",
}
```

**Manual configuration:** keep the key in the environment and declare the provider in `~/.config/kilo/kilo.json` or `./kilo.json`, so the secret never lands in the project file. The `baseURL` is required while SOKKAN Router is not in the catalogue, and harmless afterwards:

```bash
export SOKKAN_API_KEY="skr_..."
```

```jsonc
{
  "provider": {
    "sokkan": {
      "name": "SOKKAN Router",
      "npm": "@ai-sdk/openai-compatible",
      "env": ["SOKKAN_API_KEY"],
      "options": { "baseURL": "https://router.sokkan.ch/v1" },
    },
  },
  "model": "sokkan/qwen/qwen3.8-27b",
}
```

{% /tab %}
{% /tabs %}

## Using a model that is not in the picker

Once SOKKAN Router is in the catalogue, the model picker lists the SOKKAN models published there. Any model id returned by [`GET /v1/models`](https://router.sokkan.ch/v1/models) can be used by declaring it yourself, as described in [Custom Models](/docs/code-with-ai/agents/custom-models). For example, the pay-per-token EU route of Qwen3.6 35B-A3B (prices as listed on 2026-10-22):

```jsonc
{
  "provider": {
    "sokkan": {
      "models": {
        "qwen/qwen3.6-35b-a3b-eu": {
          "name": "Qwen3.6 35B-A3B (EU)",
          "cost": { "input": 0.2, "output": 1.4, "cache_read": 0.05 },
          "limit": { "context": 262144, "output": 32768 },
        },
      },
    },
  },
  "model": "sokkan/qwen/qwen3.6-35b-a3b-eu",
}
```

This model reasons by default: leave room in `max_tokens` (1024 or more) when you expect a tool call or JSON output.

Use the identifier exactly as it appears in the models endpoint. Declare `cost` and `limit` as shown; Kilo defaults both to zero for a model it does not already know, which would leave spend reporting and the context gauge wrong. Costs are per million tokens, straight from the endpoint's `pricing.prompt` / `pricing.completion` / `pricing.cached`.

## Data location (CH / EU)

Every SOKKAN response carries an `x-sokkan-region` header naming the zone (`CH`, `EU` or `US`) that generated it. To restrict where a request may run, send the `X-Data-Location` header through the provider options (or a model's own `headers` block to pin a single model):

```jsonc
{
  "provider": {
    "sokkan": {
      "options": {
        "headers": { "X-Data-Location": "CH" },
      },
    },
  },
}
```

If the selected model does not run in the requested zone, SOKKAN returns `400 no_provider` and nothing is sent elsewhere; pick a model whose id or zone already matches what you need (the `/v1/models` entries list each model's `regions`).

## Committed-throughput models

Some models on SOKKAN are sold as a prepaid throughput commitment rather than per token. In `/v1/models` these show `"availability": "committed"` and return `403 committed_throughput` on a plain API key until an account has an active commitment for that model; do not add one to the picker or to `provider.sokkan.models` until it also reports `"available": true`.

## Troubleshooting

- **Invalid API key:** create a new key at [router.sokkan.ch](https://router.sokkan.ch), then reconnect with `/connect` / `kilo auth login --provider sokkan`, or update `SOKKAN_API_KEY` if you use manual configuration.
- **Model not found / 403 `committed_throughput`:** copy an id from [`/v1/models`](https://router.sokkan.ch/v1/models) with `"availability": "on_demand"` (pay per token). A `committed` model needs an active commitment first (see above).
- **400 `secret_detected`:** the prompt contained credentials (API keys, tokens, private keys) and was refused before reaching the model. Remove the secret from the context (for example an `.env` file the agent read) and retry.
- **402 `insufficient_balance`:** top up the balance in your account, or lower `max_tokens`.
- **400 `no_provider`:** the model does not run in the zone you restricted with `X-Data-Location`. Drop the header or pick a model listed for that zone.
- **Provider not visible / `Unknown provider "sokkan"`:** SOKKAN Router is not in your models.dev catalogue yet. Use **Custom provider** (VS Code) or `/connect` → **Other** with the provider id `sokkan`, and set `options.baseURL` as shown in [Configure Kilo Code](#configure-kilo-code).

{% callout type="note" %}
This documentation was contributed by SOKKAN Router, the provider it describes.
{% /callout %}
