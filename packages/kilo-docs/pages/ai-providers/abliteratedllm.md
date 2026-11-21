---
title: "Using AbliteratedLLM with Kilo Code"
description: "Connect Kilo Code to AbliteratedLLM, a built-in OpenAI-compatible provider for abliterated and stock open-weight models."
sidebar_label: AbliteratedLLM
---

# Using AbliteratedLLM With Kilo Code

[AbliteratedLLM](https://abliteratedllm.dev) is a pay-per-token, OpenAI- and Anthropic-compatible API for abliterated (refusal-removed) and stock open-weight models. Abliterated models have had their refusal behavior removed; the other models in the catalog are the vendors' original weights. AbliteratedLLM is a built-in provider in Kilo Code, so no custom provider config is needed. Kilo Code uses the `abliteratedllm` provider ID and reads your API key from `ABLITERATEDLLM_API_KEY`.

## Before you begin

1. Create an account at [abliteratedllm.dev](https://abliteratedllm.dev). Usage is prepaid; see [pricing](https://abliteratedllm.dev/pricing).
2. Create an API key on the [API keys page](https://abliteratedllm.dev/dashboard/keys).

## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Click **Show more providers**, search for **AbliteratedLLM**, and select it.
3. Paste your key into **AbliteratedLLM API key** and click **Submit**.
4. Pick an AbliteratedLLM model, such as `abliteratedllm/glm-5.3-flash-abliterated`.

The provider credentials are stored in Kilo's `auth.json` store.

{% /tab %}
{% tab label="CLI" %}

**Recommended:** connect interactively so the API key is stored in Kilo's `auth.json` store, the same credential store the VS Code extension uses.

1. In the TUI, run `/connect`, choose **AbliteratedLLM**, then paste your API key.
2. Or from the shell:

```bash
kilo auth login --provider abliteratedllm
```

**Environment variable (optional):** Kilo Code also picks up the key from the environment, so the secret never lands in a config file:

```bash
export ABLITERATEDLLM_API_KEY="your-api-key"
```

Then pick a model with `/models`, or set a default model in `provider-id/model-id` form in `~/.config/kilo/kilo.json` or `./kilo.json`:

```jsonc
{
  "model": "abliteratedllm/glm-5.3-flash-abliterated",
}
```

{% /tab %}
{% /tabs %}

## Models

The model list, context and output limits, pricing and reasoning settings come from the [models.dev catalog](https://models.dev/providers/abliteratedllm), so there is nothing to configure per model. Run `kilo models abliteratedllm` to list the models Kilo Code knows. AbliteratedLLM's own live catalog is public and needs no key at [api.abliteratedllm.dev/v1/models](https://api.abliteratedllm.dev/v1/models).

A model on the models endpoint that the catalog does not list yet can still be declared under `provider.abliteratedllm.models`, as described in [Custom Models](/docs/code-with-ai/agents/custom-models).

## API compatibility

Kilo Code connects to AbliteratedLLM through the OpenAI-compatible Chat Completions API at `https://api.abliteratedllm.dev/v1`. AbliteratedLLM also exposes an Anthropic Messages endpoint, but Kilo Code does not use it for this provider.

- Every model is a reasoning model. Kilo Code offers each model's own reasoning-effort levels from the catalog, for example `low`, `high` and `max` on the GLM-5.3 models.
- Audio and file attachments are rejected. Image input works only on models whose `input_modalities` on the models endpoint include `image`.

For standalone cURL, Python and TypeScript examples, see the [AbliteratedLLM examples repository](https://github.com/abliteratedllm/examples).

## Troubleshooting

- **Invalid API key (HTTP 401):** create a new key on the [API keys page](https://abliteratedllm.dev/dashboard/keys), then reconnect with **Change API key** in the VS Code **Providers** tab, `/connect` or `kilo auth login --provider abliteratedllm`, or update `ABLITERATEDLLM_API_KEY`.
- **Model not found:** copy the model ID exactly as `kilo models abliteratedllm` lists it, including the `abliteratedllm/` prefix.
- **Provider not listed:** run `kilo models --refresh` to update Kilo's cached copy of the models.dev catalog, then restart Kilo Code. The model picker and `kilo models` show AbliteratedLLM only after you connect a key or set `ABLITERATEDLLM_API_KEY`.
- **HTTP 429:** trial accounts allow one concurrent request and 10 requests per minute per key. Wait for the `Retry-After` interval and try again.

{% callout type="note" %}
This documentation was contributed by AbliteratedLLM, the provider it describes.
{% /callout %}
