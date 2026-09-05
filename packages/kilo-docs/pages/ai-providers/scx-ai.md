---
title: "Using SCX.ai with Kilo Code | Australian-Hosted Open Models"
description: "Run open models like MiniMax, GLM, and Qwen on SCX.ai's OpenAI-compatible API in Kilo Code. Setup guide for VS Code and the CLI."
---

# Using SCX.ai with Kilo Code

[SCX.ai](https://scx.ai) is an Australian sovereign AI platform serving open models such as MiniMax, GLM, and Qwen over an OpenAI-compatible API, hosted on renewable-powered infrastructure in Australia. It is available as a built-in provider in Kilo Code under the provider ID `scx-ai`, and reads your API key from `SCX_API_KEY`.

**Website:** [https://scx.ai](https://scx.ai)

## Getting an API key

1. **Sign up/sign in:** Go to the [SCX.ai platform](https://platform.scx.ai) and create an account or sign in.
2. **Create a key:** Generate an API key from the platform and copy it.

## Configuration in Kilo Code

SCX.ai is a **built-in provider** in Kilo Code, so you can connect it directly — no custom provider setup needed.

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** (gear icon) and go to the **Providers** tab.
2. Click **Connect provider**, search for **SCX.ai**, and select it. If it is not visible, click **Show more providers**.
3. Enter your SCX.ai API key.
4. Pick a model, such as **MiniMax-M2.7** or **GLM-5.2**.

{% /tab %}
{% tab label="CLI" %}

**Method 1 — `/connect` (recommended)**

Run `kilo`, then use the `/connect` command, select **SCX.ai**, and paste your API key when prompted:

```bash
kilo
# then, inside Kilo, run:
/connect
```

**Method 2 — config file**

Keep the key in the environment and declare the provider in your `kilo.json` config file (`~/.config/kilo/kilo.json` or `./kilo.json`):

```bash
export SCX_API_KEY="your-api-key"
```

```jsonc
{
  "provider": {
    "scx-ai": {
      "env": ["SCX_API_KEY"],
    },
  },
  "model": "scx-ai/MiniMax-M2.7",
}
```

{% /tab %}
{% /tabs %}

## Models

The model picker lists the SCX.ai models published in the catalogue Kilo refreshes:

- `MiniMax-M2.7`
- `GLM-5.2`
- `Qwen3.8-Max`
- `gpt-oss-120b`

All four support tool calling and reasoning. SCX.ai serves a larger catalogue than the picker shows; any model on the platform can be used by declaring it yourself, as described in [Custom Models](/docs/code-with-ai/agents/custom-models). A model declared this way inherits the SCX.ai API base and protocol, so nothing else needs configuring. Declare `cost` and `limit` on it if you want spend reporting and the context gauge to be right — Kilo defaults both to zero for a model it does not already know.

## Tips and notes

- **Model IDs are case-sensitive.** Use them exactly as shown: `MiniMax-M2.7` and `GLM-5.2` are mixed case, `gpt-oss-120b` is lowercase.
- **Reasoning effort levels vary by model.** `GLM-5.2` and `Qwen3.8-Max` accept the full range from `none` to `max`; `MiniMax-M2.7` and `gpt-oss-120b` accept `low`, `medium`, and `high`.
- **Billing:** SCX.ai meters usage in AUD through Service Token Units. The spend Kilo Code shows is an estimate derived from token counts; your [SCX.ai platform](https://platform.scx.ai) dashboard is the authoritative figure.
- **Documentation:** See the [SCX.ai docs](https://platform.scx.ai/docs) for the full model list and supported parameters.
