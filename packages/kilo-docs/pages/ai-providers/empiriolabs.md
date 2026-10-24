---
title: "Using EmpirioLabs AI with Kilo Code"
description: "Configure EmpirioLabs AI, specialized AI model hosting for open, proprietary, and custom stacks, in Kilo Code. Setup guide for VS Code and the CLI."
sidebar_label: EmpirioLabs AI
---

# Using EmpirioLabs AI With Kilo Code

EmpirioLabs AI is specialized AI model hosting for open, proprietary, and custom stacks. Its OpenAI-compatible API is at `https://api.empiriolabs.ai/v1`, and Kilo Code includes it as a built-in provider.

**Website:** [https://empiriolabs.ai](https://empiriolabs.ai)

**Documentation:** [https://docs.empiriolabs.ai](https://docs.empiriolabs.ai)

## Getting an API Key

1. Sign in or create an account at [platform.empiriolabs.ai](https://platform.empiriolabs.ai).
2. Open [API Keys](https://platform.empiriolabs.ai/dashboard/api-keys) and create a key. Keys start with `sk-empiriolabs-`.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon), go to the **Providers** tab, choose **EmpirioLabs AI**, and enter your API key.

Then select an EmpirioLabs AI model such as `qwen3-7-max` or `glm-5-3`.

{% /tab %}
{% tab label="CLI" %}

**Method 1: `/connect` (recommended)**

Run `kilo`, then use the `/connect` command, select **EmpirioLabs AI**, and paste your API key when prompted:

```bash
kilo
# then, inside Kilo, run:
/connect
```

**Method 2: config file**

Set the API key as an environment variable:

```bash
export EMPIRIOLABS_API_KEY="sk-empiriolabs-your-key"
```

Then select the built-in EmpirioLabs AI provider in your `kilo.json` file:

```jsonc
{
  "provider": {
    "empiriolabs": {
      "env": ["EMPIRIOLABS_API_KEY"]
    }
  },
  "model": "empiriolabs/qwen3-7-max"
}
```

{% /tab %}
{% /tabs %}

## Models

Kilo Code lists the EmpirioLabs AI models published on models.dev. Good starting points for coding are `qwen3-7-max`, `glm-5-3`, `kimi-k2-7-code`, `deepseek-v4-pro` and `minimax-m2-7`. The full catalog with prices is at [docs.empiriolabs.ai/models-pricing](https://docs.empiriolabs.ai/models-pricing).

## Tips and Notes

- EmpirioLabs AI uses the OpenAI-compatible chat completions API, with streaming and tool calling.
- To use a model that is not in the list yet, add it under `provider.empiriolabs.models` in `kilo.json` with the model ID from the catalog.
- The [EmpirioLabs AI MCP server](https://docs.empiriolabs.ai/mcp) at `https://mcp.empiriolabs.ai/mcp` adds image, video and speech generation and web search as tools.
