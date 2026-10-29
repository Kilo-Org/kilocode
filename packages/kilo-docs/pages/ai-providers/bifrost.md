---
title: "Using Bifrost with Kilo Code"
description: "Connect Kilo Code to Bifrost, a self-hosted open-source AI gateway, through its OpenAI-compatible API with a virtual key."
sidebar_label: Bifrost
---

# Using Bifrost With Kilo Code

[Bifrost](https://github.com/maximhq/bifrost) is an open-source (Apache-2.0) AI gateway that you run on your own infrastructure. It puts providers such as OpenAI, Anthropic, Google Gemini, AWS Bedrock, and Ollama behind one OpenAI-compatible API, and adds virtual keys with budgets and rate limits, provider fallbacks, load balancing, and semantic caching. Requests go from Kilo Code to your gateway, and from there to the providers you configure with your own provider keys.

Kilo Code does not have a built-in Bifrost provider, so you add Bifrost as a custom OpenAI-compatible provider.

**Website:** [https://docs.getbifrost.ai](https://docs.getbifrost.ai)

## Before you begin

1. Start a Bifrost gateway, for example with `npx -y @maximhq/bifrost` or `docker run -p 8080:8080 maximhq/bifrost`. It listens on `http://localhost:8080` by default. These unversioned commands are meant for local evaluation. For a shared deployment, pin a version and enable authentication as described in the [Bifrost setup guide](https://docs.getbifrost.ai/quickstart/gateway/setting-up).
2. Open the Bifrost web UI at `http://localhost:8080`, go to **Model Providers**, and add API keys for the providers you want to use.
3. Optionally, create a [virtual key](https://docs.getbifrost.ai/features/governance/virtual-keys) to apply budgets, rate limits, and model access rules to Kilo Code's traffic. Virtual keys normally start with `sk-bf-`.

## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Scroll to the bottom and click **Custom provider**.
3. Fill in the custom provider dialog:
   - **Provider ID**: `bifrost`
   - **Display name**: `Bifrost`
   - **Provider API**: **OpenAI Compatible**
   - **Base URL**: `http://localhost:8080/openai`, or the same path on your gateway's address
   - **API key**: your Bifrost virtual key. If your gateway does not enforce virtual keys, enter any non-empty string.
   - **Models**: click **Fetch models** to load the models your gateway serves, or add model IDs such as `openai/gpt-5` manually
4. Click **Submit**. The Bifrost models appear in the model picker.

{% /tab %}
{% tab label="CLI" %}

Set your virtual key as an environment variable:

```bash
export BIFROST_VIRTUAL_KEY="sk-bf-..."
```

Then add Bifrost as a custom provider in your global config file (`~/.config/kilo/kilo.json`). You must define at least one model. Setting `limit` lets Kilo Code manage the context window:

```jsonc
{
  "provider": {
    "bifrost": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:8080/openai",
        "apiKey": "{env:BIFROST_VIRTUAL_KEY}",
      },
      "models": {
        "openai/gpt-5": {
          "name": "GPT-5 via Bifrost",
          "tool_call": true,
          "limit": {
            "context": 400000,
            "output": 128000,
          },
        },
      },
    },
  },
  "model": "bifrost/openai/gpt-5",
}
```

Kilo Code resolves `{env:...}` references only in trusted config such as your global config, not in a project-level `kilo.json`. See [Custom Models](/docs/code-with-ai/agents/custom-models) for all model fields.

If your gateway does not enforce virtual keys, set `apiKey` to any non-empty string.

{% /tab %}
{% /tabs %}

## Model naming

Bifrost model IDs use the `provider/model` form, for example `openai/gpt-5` or `anthropic/claude-sonnet-4-6`. A full model reference in Kilo Code therefore has three segments: `bifrost/<provider>/<model>`. The provider must have a key configured in Bifrost. The gateway's `GET /v1/models` endpoint lists the models it can serve.

## Tips and notes

- Budgets and rate limits attached to the virtual key are enforced by the gateway, so Kilo Code needs no extra configuration for them.
- If your gateway has authentication enabled on inference requests, the `Authorization` header carries those credentials, and the virtual key goes in the `x-bf-vk` header instead. Add it under **Headers** in the custom provider dialog, or as a model `headers` entry in `kilo.json`.
- Kilo Code's agents rely on tool calling, so choose models that support it.

## Troubleshooting

- **Connection errors:** Confirm the gateway is running and reachable from the machine running Kilo Code, for example with `curl http://localhost:8080/health`.
- **Authentication errors:** Check that the virtual key is valid. If authentication is enabled on your gateway, send the virtual key in the `x-bf-vk` header.
- **Model not found:** Use the exact `provider/model` ID, and confirm that the provider has a key configured in Bifrost.
