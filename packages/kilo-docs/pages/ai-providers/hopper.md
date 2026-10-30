---
title: "Using Hopper with Kilo Code"
description: "Connect your Hopper API key to use DeepSeek V4.1 Flash 1017 and its abliterated variant in Kilo Code."
sidebar_label: Hopper
---

# Using Hopper with Kilo Code

[Hopper](https://withhopper.com/) serves open models through an OpenAI-compatible API. Kilo Code reads Hopper's model catalog from [models.dev](https://models.dev/providers/hopper/), so you can connect your API key using the built-in `hopper` provider.

## Before you begin

1. Sign up or sign in at the [Hopper console](https://withhopper.com/console/keys).
2. Create an API key and copy it.
3. Check your account's available credit and the current [model pricing](https://docs.withhopper.com/models).

## Connect to Hopper

{% tabs %}
{% tab label="VS Code" %}

1. Open **Settings** (gear icon) and go to **Providers**.
2. Click **Connect provider**, search for **Hopper**, and select it.
3. Paste your Hopper API key.
4. Select a Hopper model in the model picker.

{% /tab %}
{% tab label="CLI" %}

Connect interactively to save your key in Kilo's credential store:

```bash
kilo auth login --provider hopper
```

Alternatively, set `HOPPER_API_KEY` in your environment:

```bash
export HOPPER_API_KEY="your-hopper-api-key"
```

List the available Hopper models and run a prompt:

```bash
kilo models hopper --refresh
kilo run --model hopper/deepseek-v4.1-flash-1017 "Explain the structure of this project."
```

{% /tab %}
{% /tabs %}

To make Hopper your default, add the model to your `kilo.json` or `kilo.jsonc`. Keep the API key in Kilo's credential store or the environment, outside the project configuration:

```json
{
  "$schema": "https://app.kilo.ai/config.json",
  "model": "hopper/deepseek-v4.1-flash-1017"
}
```

## Choose a model

The catalog includes these model references:

- `hopper/deepseek-v4.1-flash-1017` — standard DeepSeek V4.1 Flash 1017.
- `hopper/deepseek-v4.1-flash-1017-abliterated` — Hopper's abliterated variant of the same model.

The [Hopper catalog on models.dev](https://models.dev/providers/hopper/) lists tool calling, reasoning, and image input for both models. Both entries have a 1,048,576-token context window shared by input and output. Refer to the catalog for current capabilities, limits, and prices.

For the abliterated variant, use its full model reference:

```bash
kilo run --model hopper/deepseek-v4.1-flash-1017-abliterated "Explain the structure of this project."
```

Kilo Code connects directly to `https://api.withhopper.com/v1` using your Hopper key. Usage is billed to your Hopper account.

## Troubleshooting

- **Hopper is missing:** update Kilo Code and refresh the provider catalog. In the CLI, run `kilo models --refresh`, then connect Hopper. In VS Code, also check **Show more providers**.
- **Hopper is disabled:** remove `hopper` from `disabled_providers`, or include it in `enabled_providers` if you use an allowlist. See [provider settings](/docs/ai-providers#disabling-built-in-providers).
- **Invalid API key:** create a key in the [Hopper console](https://withhopper.com/console/keys), then reconnect the provider or update `HOPPER_API_KEY`.
- **Insufficient credit:** check your [Hopper billing balance](https://withhopper.com/console/billing).

See Hopper's [standard DeepSeek guide](https://withhopper.com/agents/deepseek-v4.1-flash-1017) and [abliterated model guide](https://withhopper.com/cyber) for provider-side setup details.
