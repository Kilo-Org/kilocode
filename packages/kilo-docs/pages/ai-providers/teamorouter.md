---
title: "Using TeamoRouter with Kilo Code"
description: "Connect Kilo Code to TeamoRouter, a pay-as-you-go gateway with one API key for Claude, GPT, Gemini, DeepSeek, GLM, Kimi, and Qwen models."
sidebar_label: TeamoRouter
---

# Using TeamoRouter With Kilo Code

[TeamoRouter](https://teamorouter.com) is a pay-as-you-go AI gateway with one API key for Claude, GPT, Gemini, DeepSeek, GLM, Kimi, and Qwen models. It serves an OpenAI-compatible API at `https://api.teamorouter.com/v1`. Claude models are also served on an Anthropic-compatible Messages endpoint at the same base URL.

**Website:** [https://teamorouter.com](https://teamorouter.com)

## Before you begin

1. Create an account at [teamorouter.com](https://teamorouter.com).
2. Create an API key in the [TeamoRouter dashboard](https://teamorouter.com/dashboard).
3. Pick the model IDs you want from the [model list](https://teamorouter.com/models). A machine-readable version with context windows and prices is public at [api.teamorouter.com/v1/models/pricing](https://api.teamorouter.com/v1/models/pricing). Availability and pricing change, so check the live list instead of copying an old one.

## Configure Kilo Code

TeamoRouter is not in Kilo's built-in provider catalog yet, so you declare it as a custom provider. Add it to `~/.config/kilo/kilo.jsonc` (global) or `./kilo.jsonc` (project). The VS Code extension, the JetBrains plugin, and the CLI all read these files.

Keep the key in the environment so it never lands in a config file:

```bash
export TEAMOROUTER_API_KEY="your-api-key"
```

```jsonc
{
  "provider": {
    "teamorouter": {
      "name": "TeamoRouter",
      "npm": "@ai-sdk/openai-compatible",
      "env": ["TEAMOROUTER_API_KEY"],
      "options": {
        "baseURL": "https://api.teamorouter.com/v1",
        // Optional: tells TeamoRouter the request comes from Kilo Code.
        "headers": { "X-Client-Source": "kilo-teamorouter" },
      },
      "models": {
        "claude-sonnet-5-5": {
          "name": "Claude Sonnet 5.5",
          // Claude uses the Anthropic-compatible endpoint.
          "provider": { "npm": "@ai-sdk/anthropic" },
          "limit": { "context": 1000000, "output": 128000 },
        },
        "deepseek-v4-flash": {
          "name": "DeepSeek V4 Flash",
          "limit": { "context": 1000000, "output": 384000 },
        },
        "glm-5.3": {
          "name": "GLM-5.3",
          "limit": { "context": 1000000, "output": 131072 },
        },
        "kimi-k3": {
          "name": "Kimi K3",
          "limit": { "context": 1000000, "output": 131072 },
        },
      },
    },
  },
  "model": "teamorouter/claude-sonnet-5-5",
}
```

Then choose a TeamoRouter model in the model picker, or change `model` in the config.

- Claude models set `provider.npm` to `@ai-sdk/anthropic`. Kilo then talks to the Anthropic-compatible endpoint, which keeps prompt caching, tool use, and thinking in their native form. Other models use the OpenAI-compatible endpoint.
- If the CLI runs from a shell, export `TEAMOROUTER_API_KEY` in that shell. For the VS Code extension, set the variable where VS Code is launched from.

## Adding more models

Any chat model ID from the [model list](https://teamorouter.com/models) can go under `models`. Use the ID exactly as listed. Model options and fields are described in [Custom Models](/docs/code-with-ai/agents/custom-models).

- Set `limit` with both `context` and `output` so the context gauge and compaction are right. The pricing endpoint lists each model's `context_window`.
- Kilo caps `output` at 32,000 tokens per request by default, so the larger `output` values in the example are not sent as-is unless you raise `KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX`. See [Custom Models](/docs/code-with-ai/agents/custom-models).
- Kilo defaults `cost` to zero for models it does not already know, so spend reporting shows zero. If you want it, add `cost` in USD per million tokens from the pricing endpoint.

## Troubleshooting

- **`Model not found: teamorouter/...`**: Kilo skipped the config file because it failed validation. Run `kilo debug config` and check that `teamorouter` appears under `provider`.
- **401 Unauthorized**: the key is wrong, or `TEAMOROUTER_API_KEY` is not set in the environment Kilo was started from.
- **402 Payment Required**: the account balance is used up. Top up in the [dashboard](https://teamorouter.com/dashboard).

{% callout type="note" %}
This documentation was contributed by TeamoRouter, the provider it describes.
{% /callout %}
