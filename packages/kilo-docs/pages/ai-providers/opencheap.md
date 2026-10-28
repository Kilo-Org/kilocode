---
title: "Using OpenCheap with Kilo Code"
description: "Connect Kilo Code to OpenCheap, an OpenAI-compatible gateway with one API key for open and closed models."
sidebar_label: OpenCheap
---

# Using OpenCheap With Kilo Code

[OpenCheap](https://opencheap.si) is an AI gateway with one API key for open and closed models. It exposes an OpenAI-compatible API at `https://api.opencheap.si/v1`, including chat completions with streaming and tool calling.

Kilo Code connects to OpenCheap as a custom OpenAI-compatible provider. No extra plugin is needed.

## Before you begin

1. Create an account at [app.opencheap.si](https://app.opencheap.si).
2. Create an API key. Keys start with `kl_live_`.
3. See the [OpenCheap pricing page](https://opencheap.si/pricing) for model prices, and the [OpenCheap docs](https://docs.opencheap.si) for the full API reference.

## Configure Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Scroll to the bottom and click **Custom provider**.
3. Fill in the dialog:
   - **Provider ID** — `opencheap`
   - **Display name** — `OpenCheap`
   - **Provider API** — **OpenAI Compatible**
   - **Base URL** — `https://api.opencheap.si/v1`
   - **API key** — your OpenCheap API key
4. Kilo Code queries `https://api.opencheap.si/v1/models` with your key and shows a searchable list. Select the models you want to add, for example `qwen3-coder` or `glm-4.7-flash`.
5. Click **Submit**. The models appear in the model picker as **OpenCheap**.

For token limits and other model options, see [Custom Models](/docs/code-with-ai/agents/custom-models).

{% /tab %}
{% tab label="CLI" %}

Set your key as an environment variable:

```bash
export OPENCHEAP_API_KEY="your-api-key"
```

Declare the provider in `~/.config/kilo/kilo.json` or `./kilo.json`:

```jsonc
{
  "provider": {
    "opencheap": {
      "name": "OpenCheap",
      "npm": "@ai-sdk/openai-compatible",
      "env": ["OPENCHEAP_API_KEY"],
      "options": {
        "baseURL": "https://api.opencheap.si/v1",
      },
      "models": {
        "qwen3-coder": {
          "name": "Qwen 3 Coder 480B",
          "limit": { "context": 262144, "output": 16384 },
        },
        "glm-4.7-flash": {
          "name": "GLM 4.7 Flash",
          "limit": { "context": 202752, "output": 16384 },
        },
      },
    },
  },
  "model": "opencheap/qwen3-coder",
}
```

Then run `kilo` and select an OpenCheap model, or pass one directly:

```bash
kilo run -m opencheap/glm-4.7-flash "Read README.md and summarize it"
```

To add more models, list them under `models`. The model IDs, names, and context sizes are returned by `GET https://api.opencheap.si/v1/models` when you send your key as a bearer token:

```bash
curl https://api.opencheap.si/v1/models -H "Authorization: Bearer $OPENCHEAP_API_KEY"
```

{% /tab %}
{% /tabs %}

## Tips and notes

- OpenCheap uses the OpenAI Chat Completions format, so use **OpenAI Compatible** as the provider API. The same key also works with `/v1/responses` and the Anthropic-style `/v1/messages` endpoint, which this page does not use.
- Use the exact model ID from the `/v1/models` list. The list changes over time, so check it instead of copying an old one.
- Pick a model that supports tool calling for agentic work. `qwen3-coder` and `glm-4.7-flash` return tool calls in both streaming and non-streaming mode.
- The `/v1/models` list also contains entries that are not chat models. Add only chat models to Kilo Code.

## Troubleshooting

- **401 or "Invalid API key":** Create a new key in the OpenCheap dashboard and update `OPENCHEAP_API_KEY` or the key in the custom provider dialog.
- **"Model not found":** Copy the model ID exactly as it appears in the `/v1/models` list.
- **No models appear in the dialog:** Check that the Base URL ends in `/v1` and that the key is entered, then click **Fetch models**.

{% callout type="note" %}
This documentation was contributed by an OpenCheap affiliate.
{% /callout %}
