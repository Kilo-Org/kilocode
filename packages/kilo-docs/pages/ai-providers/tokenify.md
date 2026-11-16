---
title: "Using Tokenify with Kilo Code | DeepSeek and GLM API"
description: "Configure Tokenify in Kilo Code through its OpenAI-compatible API to use DeepSeek V4 and GLM models with one API key."
sidebar_label: Tokenify
---

# Using Tokenify With Kilo Code

Tokenify exposes an OpenAI-compatible API at `https://api.tokenify.dev/v1`, serving DeepSeek V4 and GLM models.
You can use it from Kilo Code with the built-in Tokenify provider, which reads its model list from [models.dev](https://models.dev).

**Website:** [https://www.tokenify.dev/](https://www.tokenify.dev/)

## Getting an API Key

1. Create an account at [tokenify.dev](https://www.tokenify.dev/app/signup).
2. Create an API key in the dashboard and copy it.
3. Usage is billed from prepaid credit, so add credit before your first request.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon), go to the **Providers** tab, click **Show more providers** if **Tokenify** is not listed, then choose **Tokenify** and enter your API key.

Then select a Tokenify model such as `deepseek/deepseek-v4-pro` or `z-ai/glm-5.2`.

{% /tab %}
{% tab label="CLI" %}

**Method 1 — `/connect` (recommended)**

Run `kilo`, then use the `/connect` command, select **Tokenify**, and paste your API key when prompted:

```bash
kilo
# then, inside Kilo, run:
/connect
```

**Method 2 — config file**

Set the API key as an environment variable:

```bash
export TOKENIFY_API_KEY="your-api-key"
```

Then configure the built-in Tokenify provider in your `kilo.json` file:

```jsonc
{
  "provider": {
    "tokenify": {
      "env": ["TOKENIFY_API_KEY"]
    }
  },
  "model": "tokenify/deepseek/deepseek-v4-pro"
}
```

{% /tab %}
{% /tabs %}

## Common Models

- `deepseek/deepseek-v4-pro` for agentic coding and long-context work.
- `deepseek/deepseek-v4-flash` and `deepseek/deepseek-v4.1-flash` for fast, lower-cost tasks.
- `z-ai/glm-5.2` for long-horizon agent tasks.
- `z-ai/glm-5.3-flash` for fast multimodal input.

The full, current list is returned by `GET https://api.tokenify.dev/v1/models`.

## Tips and Notes

- Tokenify uses the OpenAI-compatible chat completions API; reasoning is returned in `reasoning_content`.
- All models reason by default.
- Prices are listed per model at [tokenify.dev/pricing](https://www.tokenify.dev/pricing/).
