---
title: "Using AI Stupid Level with Kilo Code"
description: "Connect Kilo Code to the AI Stupid Level router, an OpenAI-compatible API that sends each request to a model picked from benchmark scores, using your own provider keys."
sidebar_label: AI Stupid Level
---

# Using AI Stupid Level With Kilo Code

[AI Stupid Level](https://aistupidlevel.info/router) is an OpenAI-compatible router. It sends each request to a model picked from its coding, reasoning and tool-use benchmark scores, and calls that model with the provider keys you add to your AI Stupid Level account. Kilo Code uses the `aistupidlevel` provider ID, reads your API key from `AISTUPIDLEVEL_API_KEY`, and connects to `https://aistupidlevel.info/v1`.

## Before you begin

1. Create an account at [aistupidlevel.info](https://aistupidlevel.info/).
2. Add a key for at least one model provider, such as OpenAI, Anthropic or Google, under [Provider keys](https://aistupidlevel.info/router/providers).
3. Create a router API key under [Router API keys](https://aistupidlevel.info/router/keys). Router keys start with `aism_`.

## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** in the Kilo Code extension.
2. Go to the **Providers** tab and add **AI Stupid Level**. If it is not visible, click **Show more providers**.
3. Enter your router API key.
4. Select a routing mode, such as **Auto Coding**.

The provider credentials are stored in Kilo's `auth.json` store.

{% /tab %}
{% tab label="CLI" %}

**Recommended:** connect interactively so the API key is stored in Kilo's `auth.json` store, the same credential store the VS Code extension uses.

1. In the TUI, run `/connect`, choose **AI Stupid Level**, then paste your router API key.
2. Or from the shell:

```bash
kilo auth login --provider aistupidlevel
```

Then pick a routing mode from the model picker, or set a default model in `provider-id/model-id` form:

```jsonc
{
  "model": "aistupidlevel/auto-coding",
}
```

**Manual configuration (optional):** keep the key in the environment and declare the provider in `~/.config/kilo/kilo.json` or `./kilo.json`, so the secret never lands in the project file:

```bash
export AISTUPIDLEVEL_API_KEY="your-router-api-key"
```

```jsonc
{
  "provider": {
    "aistupidlevel": {
      "env": ["AISTUPIDLEVEL_API_KEY"],
    },
  },
  "model": "aistupidlevel/auto-coding",
}
```

{% /tab %}
{% /tabs %}

## Routing modes

Each model is a routing mode, not a fixed model: the router picks the model for each request.

| Model ID | Name | Description |
|---|---|---|
| `auto` | Auto (account strategy) | Uses the strategy saved in your account's routing preferences |
| `auto-best` | Auto Best | Routes to the top model on the combined benchmark score |
| `auto-coding` | Auto Coding | Routes to the top model on the coding benchmark |
| `auto-reasoning` | Auto Reasoning | Routes to the top model on the reasoning benchmark |
| `auto-tooling` | Auto Tool Use | Routes to the top model on the tool-use benchmark |
| `auto-fastest-quality` | Auto Fastest Quality | Routes to the fastest model within 5 points of the best |
| `auto-value` | Auto Value | Routes to the model with the most benchmark points per measured dollar, among models within 5 points of the best |
| `auto-value-coding` | Auto Value Coding | Routes to the model with the most coding points per measured dollar, among models within 5 points of the best |
| `auto-value-reasoning` | Auto Value Reasoning | Routes to the model with the most reasoning points per measured dollar, among models within 5 points of the best |
| `auto-value-tooling` | Auto Value Tool Use | Routes to the model with the most tool-use points per measured dollar, among models within 5 points of the best |

When the leading models on `auto-best`, `auto-coding`, `auto-reasoning` or `auto-tooling` are statistically tied, the router picks the cheapest of them by default.

## Limits and pricing

- **Text only:** the routing modes take and return text. A request with images, audio or files is rejected with a `400 unsupported_content` error.
- **Context and output:** each routing mode is listed with a 262,144-token context window and a 64,000-token output limit. These are the smallest limits among the models the router can pick, so they hold whichever model answers.
- **Pricing:** the routing modes have no price in the [models.dev](https://models.dev/providers/aistupidlevel) catalog. Kilo Code calculates spend from catalog prices, so it records no spend for them. Each request is billed by the provider of the model that answers it, to the provider key you added, and that provider's billing is the record of what you spent.

## Troubleshooting

- **`400 no_provider_keys`:** your AI Stupid Level account has no provider key yet. Add one under [Provider keys](https://aistupidlevel.info/router/providers).
- **`400 provider_key_rejected`:** the provider refused a saved key, for example because it was revoked or mistyped. Replace it under Provider keys.
- **`401 invalid_api_key`:** the router API key is missing or invalid. Create a new key, then reconnect with `/connect` or `kilo auth login --provider aistupidlevel`, or update `AISTUPIDLEVEL_API_KEY` if you use manual configuration.
- **Provider not visible:** Kilo Code reloads the models.dev catalog at startup and every 60 minutes. Restart Kilo Code, then check **Show more providers**.

The [router API documentation](https://aistupidlevel.info/router/docs) lists the other error codes.

{% callout type="note" %}
This documentation was contributed by Studio Platforms, the company behind AI Stupid Level.
{% /callout %}
