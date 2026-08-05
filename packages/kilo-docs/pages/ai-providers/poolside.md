---
title: "Using Poolside with Kilo Code"
description: "Connect Poolside's Laguna models for software engineering to Kilo Code. Use Kilo Gateway, a Poolside Platform API key, or OpenRouter. Guide to setup in VS Code and the CLI."
sidebar_label: Poolside
---

# Using Poolside With Kilo Code

Poolside develops the Laguna family of models for software engineering. Choose an access path based on where you want to manage authentication and billing.

**Website:** [https://poolside.ai/](https://poolside.ai/)

## Provider Options

| Access path | Use it for | Required access |
|---|---|---|
| Kilo Gateway | The fastest setup in Kilo Code | None for free models; Kilo Code sign-in for paid models |
| Poolside Platform | Direct access through Poolside's OpenAI-compatible API | Poolside Platform API key |
| OpenRouter | Poolside models billed and managed through OpenRouter | OpenRouter API key |

## Kilo Gateway

### Get Access

Free models work without signing in and are rate-limited by IP. Sign in to Kilo Code for paid models.

### Configure Kilo

{% tabs %}
{% tab label="VSCode" %}

1. Open the model picker in Kilo Code.
2. Search for `Poolside`.
3. Select a Poolside model. Sign in to Kilo Code if the model requires a paid account.
4. Send a prompt to confirm the model responds.

{% /tab %}
{% tab label="CLI" %}

1. Run `kilo`.
2. To use paid models, run `/connect`, select **Kilo Gateway**, and sign in. Skip this step for free models.
3. Run `/models` and search for `Laguna`.
4. Select a Poolside model and send a prompt to confirm it responds.

{% /tab %}
{% /tabs %}

See [Poolside models on Kilo Code](https://kilo.ai/models/by/poolside) for current availability.

## Poolside Platform

### Get Access

Sign in to [Poolside Platform](https://platform.poolside.ai/), open **API Keys**, click **New key**, and copy the key.

### Configure Kilo

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Find **Custom provider** and click **Connect**.
3. Enter `poolside-platform` for **Provider ID** and `Poolside Platform` for **Display name**.
4. Select **OpenAI Compatible** for **Provider API**.
5. Enter `https://inference.poolside.ai/v1` for **Base URL** and paste your Poolside Platform API key.
6. Select the models you want from the models Kilo Code finds for the endpoint.
7. Click **Submit**, then select a Poolside Platform model from the model picker.

{% /tab %}
{% tab label="CLI" %}

1. Set your Poolside Platform API key in your environment:

   ```bash
   export POOLSIDE_API_KEY="<api-key>"
   ```

2. Add the provider to a [global or project `kilo.jsonc` file](/docs/getting-started/settings#managing-settings).

   The example uses Laguna S 2.1's published context window. Set `limit.context` for any model you add this way: without it, Kilo cannot tell when to compact a conversation, and the conversation grows until the provider rejects the request.

   ```jsonc
   {
     "provider": {
       "poolside-platform": {
         "npm": "@ai-sdk/openai-compatible",
         "env": ["POOLSIDE_API_KEY"],
         "models": {
           "poolside/laguna-s-2.1": {
             "name": "Laguna S 2.1",
             "reasoning": true,
             "limit": {
               "context": 1048576,
             },
             "variants": {
               "thinking-off": {
                 "chat_template_kwargs": {
                   "enable_thinking": false,
                 },
               },
             },
           },
         },
         "options": {
           "baseURL": "https://inference.poolside.ai/v1",
         },
       },
     },
     "model": "poolside-platform/poolside/laguna-s-2.1",
   }
   ```

3. Run `kilo` and send a prompt to confirm the model responds.

Replace the example model ID with the ID for the model you want to use, and set `limit.context` to that model's published context window.

{% /tab %}
{% /tabs %}

See the [Poolside API examples](https://docs.poolside.ai/api/openai-api-examples) for the `/models` endpoint and current model IDs, and [supported models](https://docs.poolside.ai/get-started/supported-models) for context windows.

## OpenRouter

### Get Access

Create and copy a key from the [OpenRouter keys page](https://openrouter.ai/keys).

### Configure Kilo

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Find **OpenRouter** and click **Connect**.
3. Paste your OpenRouter API key and click **Submit**.
4. Open the model picker and search for a Poolside model served through OpenRouter.
5. Select the model and send a prompt to confirm it responds.

{% /tab %}
{% tab label="CLI" %}

1. Set your OpenRouter API key in your environment:

   ```bash
   export OPENROUTER_API_KEY="<api-key>"
   ```

2. Add OpenRouter and a Poolside model to a [global or project `kilo.jsonc` file](/docs/getting-started/settings#managing-settings):

   ```jsonc
   {
     "provider": {
       "openrouter": {
         "env": ["OPENROUTER_API_KEY"],
       },
     },
     "model": "openrouter/poolside/laguna-s-2.1",
   }
   ```

3. Run `kilo` and send a prompt to confirm the model responds.

Replace the example model ID with the ID for the model you want to use.

{% /tab %}
{% /tabs %}

See [Poolside models on OpenRouter](https://openrouter.ai/poolside) for current availability and model IDs. For advanced configuration, see [Using OpenRouter with Kilo Code](/docs/ai-providers/openrouter).

## Reasoning Variants

Laguna models reason natively, and thinking can be turned on or off per request.

Poolside Platform enables thinking by default. To turn it off, add the `thinking-off` variant from the Poolside Platform CLI example to your `kilo.jsonc` file. In VS Code, select it from the thinking selector next to the model picker. In the CLI, cycle variants with `Ctrl+T`. The variant sends `chat_template_kwargs.enable_thinking` as `false`.

Through OpenRouter, reasoning is controlled by OpenRouter's own `reasoning` options instead — see [Using OpenRouter with Kilo Code](/docs/ai-providers/openrouter) for how to set model options.

## Tips and Notes

- **Model IDs:** Available models and model IDs differ by access path. Use the IDs listed for the path you configured rather than copying them between paths.
- **Free models:** Some free models may use your prompts to improve models. Kilo Code marks these **May train** in the CLI model list, and the VS Code settings can hide them.
- **Poolside deployments:** For deployment endpoints and other API access methods, see the [Poolside API documentation](https://docs.poolside.ai/api/overview).
- **Pricing:** Check [Poolside models on Kilo Code](https://kilo.ai/models/by/poolside) or [Poolside models on OpenRouter](https://openrouter.ai/poolside) for current pricing on the path you use.
