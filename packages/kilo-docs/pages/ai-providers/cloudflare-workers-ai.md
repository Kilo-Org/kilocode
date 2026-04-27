---
description: Configure Cloudflare Workers AI in Kilo Code to run open-source models on Cloudflare's global GPU network via the OpenAI-compatible endpoint.
keywords:
  - kilo code
  - cloudflare
  - cloudflare workers ai
  - workers ai
  - ai provider
  - openai compatible
sidebar_label: Cloudflare Workers AI
---

# Using Cloudflare Workers AI With Kilo Code

[Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) runs open-source large language models on Cloudflare's global GPU network. Models are served through an OpenAI-compatible endpoint, billed per-token, and available with no infrastructure to manage.

**Website:** [https://developers.cloudflare.com/workers-ai/](https://developers.cloudflare.com/workers-ai/)

## Getting Credentials

You need two values:

1. **Account ID** — visible in the right sidebar of any zone in the [Cloudflare dashboard](https://dash.cloudflare.com), or under **Workers & Pages → Overview**.
2. **API Token** — create one at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens). Use the **"Workers AI"** template, or create a custom token with the `Workers AI: Read` permission. Copy the token immediately — it is only shown once.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1. **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2. **Select Provider:** Choose "Cloudflare Workers AI" from the "API Provider" dropdown.
3. **Enter Account ID and API Token:** Paste your Cloudflare Account ID and API token into the corresponding fields.
4. **Select Model:** Choose your desired model from the "Model" dropdown.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Cloudflare Workers AI. You'll be prompted for your Account ID and API token.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Authenticate interactively, or set environment variables:

```bash
kilo auth cloudflare-workers-ai
```

**Environment variables:**

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_API_TOKEN="your-api-token"
# CLOUDFLARE_API_KEY is also accepted as a legacy alias.
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "cloudflare-workers-ai": {
      "env": ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
    },
  },
}
```

Then set your default model:

```jsonc
{
  "model": "cloudflare-workers-ai/@cf/moonshotai/kimi-k2.6",
}
```

{% /tab %}
{% /tabs %}

## Supported Models

Kilo Code automatically picks up the current Workers AI model catalog from `models.dev`. Highlights for coding workflows:

| Model ID                                  | Context | Tool calls | Reasoning | Vision |
| ----------------------------------------- | ------- | ---------- | --------- | ------ |
| `@cf/moonshotai/kimi-k2.6`                | 262k    | ✓          | ✓         | ✓      |
| `@cf/moonshotai/kimi-k2.5`                | 256k    | ✓          | ✓         | ✓      |
| `@cf/nvidia/nemotron-3-120b-a12b`         | 256k    | ✓          | ✓         |        |
| `@cf/google/gemma-4-26b-a4b-it`           | 256k    | ✓          | ✓         | ✓      |
| `@cf/openai/gpt-oss-120b`                 | 128k    | ✓          | ✓         |        |
| `@cf/openai/gpt-oss-20b`                  | 128k    | ✓          | ✓         |        |
| `@cf/zai-org/glm-4.7-flash`               | 128k    | ✓          | ✓         |        |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 128k    | ✓          |           | ✓      |

For the full and current list, see the [Workers AI model catalog](https://developers.cloudflare.com/workers-ai/models/).

## Prompt Caching

Workers AI offers [prefix caching](https://developers.cloudflare.com/workers-ai/features/prompt-caching/) on supported models, which reduces Time to First Token and bills cached input tokens at a discounted rate. Cache hits require requests in the same logical session to be routed to the same model instance — controlled by the `x-session-affinity` header.

Kilo Code sends `x-session-affinity: <session-id>` automatically on every request, so prefix caching works out of the box for agentic coding sessions where each turn reuses the prior turn's prompt. Cached token counts are returned in the response `usage` object.

To maximize cache hits in your own prompts/modes, follow the [Cloudflare guidance](https://developers.cloudflare.com/workers-ai/features/prompt-caching/#structuring-prompts-for-caching): put static content (system prompts, tool definitions) at the start, and avoid timestamps in system prompts.

## Tips and Notes

- **Kimi K2.6** is a strong default for agentic coding — it has a 262k context window, supports reasoning, tool calls, and vision, and is trained for agent workflows.
- **OpenAI-compatible endpoint:** Kilo talks to `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1` via the `@ai-sdk/openai-compatible` package, so streaming, tool calls, and reasoning all work the same as with native OpenAI.
- **Routing through AI Gateway:** If you want analytics, caching, rate-limiting, or budgeting on top of Workers AI, use the [Cloudflare AI Gateway](/docs/ai-providers/cloudflare-ai-gateway) provider instead — it can route the same Workers AI models through your gateway.
- **Pricing:** Per-token, billed against your Cloudflare account. See [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).
