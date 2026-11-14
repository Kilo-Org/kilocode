---
title: "Using AbliteratedLLM with Kilo Code"
description: "Connect Kilo Code to AbliteratedLLM's OpenAI-compatible API for abliterated and stock open-weight models, set up as a custom provider."
sidebar_label: AbliteratedLLM
---

# Using AbliteratedLLM With Kilo Code

[AbliteratedLLM](https://abliteratedllm.dev) is a pay-per-token, OpenAI- and Anthropic-compatible API for abliterated (refusal-removed) and stock open-weight models. Abliterated models have had their refusal behavior removed; the other models in the catalog are the vendors' original weights. This page uses the `abliteratedllm` provider ID and the `ABLITERATEDLLM_API_KEY` environment variable.

{% callout type="info" %}
AbliteratedLLM is not in the [models.dev](https://models.dev) catalog yet, so it does not appear in Kilo Code's built-in provider list. Until it does, add it as a custom provider as shown below. The [pending catalog entry](https://github.com/anomalyco/models.dev/pull/13185) uses the same `abliteratedllm` ID. Once it is merged, AbliteratedLLM appears in `/connect` and **Connect provider** without any custom provider config, and `kilo auth login --provider abliteratedllm` works.
{% /callout %}

## Before you begin

1. Create an account at [abliteratedllm.dev](https://abliteratedllm.dev). Usage is prepaid; see [pricing](https://abliteratedllm.dev/pricing).
2. Create an API key on the [API keys page](https://abliteratedllm.dev/dashboard/keys).
3. Choose a model ID. The live catalog, with context length, maximum output and pricing per model, is public and needs no key at [api.abliteratedllm.dev/v1/models](https://api.abliteratedllm.dev/v1/models). Read the catalog rather than copying an old model list.

## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. In the **Custom provider** row, click **Connect**.
3. Fill in the dialog:
   - **Provider ID:** `abliteratedllm`
   - **Display name:** `AbliteratedLLM`
   - **Provider API:** **OpenAI Compatible**
   - **Base URL:** `https://api.abliteratedllm.dev/v1`
   - **API key:** your AbliteratedLLM API key
4. Click **Fetch models**, add the models you want, and turn on **Reasoning** for them.
5. Click **Submit**.

The dialog saves the provider to your global Kilo config and the key to Kilo's `auth.json` store. It does not set token limits, so add `limit` (and optionally `cost`) to each model in the global config as shown in the **CLI** tab. Without `limit`, Kilo Code cannot compact long conversations. For GLM models, also disable the `none` variant as shown there (see [API compatibility](#api-compatibility)).

{% /tab %}
{% tab label="CLI" %}

Add AbliteratedLLM as a custom provider in `~/.config/kilo/kilo.json` or `./kilo.json`:

```jsonc
{
  "provider": {
    "abliteratedllm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "AbliteratedLLM",
      "env": ["ABLITERATEDLLM_API_KEY"],
      "options": {
        "baseURL": "https://api.abliteratedllm.dev/v1",
      },
      "models": {
        "glm-5.3-flash-abliterated": {
          "name": "GLM-5.3 Flash Abliterated",
          "reasoning": true,
          "modalities": { "input": ["text", "image"], "output": ["text"] },
          "variants": { "none": { "disabled": true } },
          "limit": { "context": 1048576, "output": 131072 },
          "cost": { "input": 0.0977, "output": 0.3421, "cache_read": 0.0098 },
        },
      },
    },
  },
  "model": "abliteratedllm/glm-5.3-flash-abliterated",
}
```

Then give Kilo Code your API key in one of two ways:

- **Credential store (recommended):** in the TUI, run `/connect`, choose **AbliteratedLLM**, and paste your key. From the shell, run `kilo auth login`, choose **Other**, and enter `abliteratedllm`. The key is stored in Kilo's `auth.json` store, the same store the VS Code extension uses.
- **Environment variable:** the `env` entry above makes Kilo Code read the key from `ABLITERATEDLLM_API_KEY`, so the secret never lands in the config file:

```bash
export ABLITERATEDLLM_API_KEY="your-api-key"
```

{% /tab %}
{% /tabs %}

## Adding models

Each model needs its own entry under `provider.abliteratedllm.models`, keyed by the exact `id` from the [models endpoint](https://api.abliteratedllm.dev/v1/models). Take the values from the same entry:

- `limit.context` from `context_length` and `limit.output` from `max_output_tokens`. Kilo Code sets both to `0` for a model it does not know, which turns off context compaction.
- `cost` from `pricing`, which is already in USD per million tokens; write the values as numbers. `cached_input` maps to `cache_read`. Without `cost`, Kilo Code reports zero spend for the model.
- `modalities` with `image` only if the model's `input_modalities` include `image`.

See [Custom Models](/docs/code-with-ai/agents/custom-models) for every model field.

## API compatibility

Kilo Code connects to AbliteratedLLM through the OpenAI-compatible Chat Completions API at `https://api.abliteratedllm.dev/v1`. AbliteratedLLM also exposes an Anthropic Messages endpoint, but the configuration on this page uses the OpenAI-compatible path.

- Every model is a reasoning model. With `reasoning: true`, Kilo Code offers reasoning-effort variants for a custom provider. For the GLM-5.3 models in the catalog these are `none`, `low`, `medium`, `high`, `xhigh` and `max`. GLM models reject `none`, so the example disables that variant. Do the same for the other GLM-5.3 models.
- Audio and file attachments are rejected. Image input works only on models that list `image` in `input_modalities`.

For standalone cURL, Python and TypeScript examples, see the [AbliteratedLLM examples repository](https://github.com/abliteratedllm/examples).

## Troubleshooting

- **Invalid API key (HTTP 401):** create a new key on the [API keys page](https://abliteratedllm.dev/dashboard/keys), then reconnect with `/connect` or `kilo auth login`, or update `ABLITERATEDLLM_API_KEY`.
- **Model not found:** copy the model ID exactly as the models endpoint returns it.
- **Provider not visible:** a custom provider needs at least one entry under `models`. Check that `provider.abliteratedllm` is in a config file Kilo Code loads.
- **HTTP 400 after picking a reasoning variant:** GLM models reject the `none` variant. Disable it as described under [API compatibility](#api-compatibility).
- **HTTP 429:** trial accounts allow one concurrent request and 10 requests per minute per key. Wait for the `Retry-After` interval and try again.

{% callout type="note" %}
This documentation was contributed by AbliteratedLLM, the provider it describes.
{% /callout %}
