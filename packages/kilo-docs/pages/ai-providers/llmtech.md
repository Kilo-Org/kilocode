---
title: "Using LLM Tech with Kilo Code | EU-Hosted Inference"
description: "Connect Kilo Code to LLM Tech, an EU-hosted OpenAI-compatible inference endpoint with zero data retention."
sidebar_label: LLM Tech
---

# Using LLM Tech With Kilo Code

[LLM Tech](https://llmtech.eu) is an EU-hosted inference provider with an OpenAI-compatible API and a zero data retention policy: prompts and completions are not stored after the request completes.

**Website:** [https://llmtech.eu](https://llmtech.eu)

## Getting an API Key

API keys are currently issued manually. Email [artem@llmtech.eu](mailto:artem@llmtech.eu) to request one; self-service signup is planned. Store the key securely — it is shown only once.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add LLM Tech and enter your API key.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Set the API key as an environment variable or configure it in your `kilo.json` config file:

**Environment variable:**

```bash
export LLMTECH_API_KEY="your-api-key"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "llmtech": {
      "env": ["LLMTECH_API_KEY"]
    }
  }
}
```

Then set your default model:

```jsonc
{
  "model": "llmtech/unsloth/Qwen3.8-27B-NVFP4"
}
```

{% /tab %}
{% /tabs %}

## Supported Models

LLM Tech serves a fixed model list from its own EU hardware:

| Model                       | Context | Max output | Input        | Output       | Cache reads  |
| --------------------------- | ------- | ---------- | ------------ | ------------ | ------------ |
| `unsloth/Qwen3.8-27B-NVFP4` | 262,144 | 32,768     | $0.38 / M    | $2.90 / M    | $0.04 / M    |

The base URL is fixed: `https://api.llmtech.eu/v1`.

## Tips and Notes

- **Zero data retention:** requests and responses are not stored on LLM Tech servers.
- **EU hardware:** inference runs entirely on hardware located in the EU.
- **Prompt caching:** cached prompt reads are billed at the reduced cache-read rate.
- **Service status:** current uptime and incidents are published at [llmtech.eu/status](https://llmtech.eu/status).

## Troubleshooting

- **Invalid API key:** Verify `LLMTECH_API_KEY` is set in the same environment that launches Kilo, or reconnect the provider in Settings.
- **Slow or failing requests:** Check [llmtech.eu/status](https://llmtech.eu/status), then retry; contact [artem@llmtech.eu](mailto:artem@llmtech.eu) if the issue persists.
