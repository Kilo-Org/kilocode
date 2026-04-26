---
description: Configure the Cloudflare AI Gateway in Kilo Code to route requests to OpenAI, Anthropic, Workers AI, and other providers through a single endpoint with caching, analytics, rate-limiting, and budget controls.
keywords:
  - kilo code
  - cloudflare
  - cloudflare ai gateway
  - ai gateway
  - ai provider
  - prompt caching
  - rate limiting
  - usage tracking
sidebar_label: Cloudflare AI Gateway
---

# Using Cloudflare AI Gateway With Kilo Code

The [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) is a unified proxy that sits in front of upstream model providers and adds caching, analytics, rate limiting, retries, fallbacks, and spend controls. Kilo Code routes through the [Unified API](https://developers.cloudflare.com/ai-gateway/usage/unified-api/), which lets one provider config in Kilo reach OpenAI, Anthropic, and Cloudflare Workers AI models through the same endpoint.

Useful links:

- Dashboard: [dash.cloudflare.com → AI → AI Gateway](https://dash.cloudflare.com/?to=/:account/ai/ai-gateway)
- Docs: [developers.cloudflare.com/ai-gateway](https://developers.cloudflare.com/ai-gateway/)
- Unified API model list: [developers.cloudflare.com/ai-gateway/usage/unified-api](https://developers.cloudflare.com/ai-gateway/usage/unified-api/)

---

## Getting Credentials

The AI Gateway requires **three** values:

1. **Account ID** — visible in the right sidebar of any zone in the [Cloudflare dashboard](https://dash.cloudflare.com), or under **Workers & Pages → Overview**.
2. **Gateway Name (Gateway ID)** — you must create a gateway in the dashboard before you can use it. Go to **AI → AI Gateway → Create Gateway**, give it a slug-style name (e.g. `kilo-code`), and use that name as `CLOUDFLARE_GATEWAY_ID`. This is the same value that appears in the gateway's URL: `gateway.ai.cloudflare.com/v1/{ACCOUNT_ID}/{GATEWAY_NAME}/...`.
3. **API Token** — create one at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens). The token needs the `AI Gateway: Run` permission. If your gateway has authentication enabled (recommended), this token is required; if it's an unauthenticated gateway it is still required so Kilo can attribute usage. Copy it immediately — it is only shown once.

---

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1. **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2. **Select Provider:** Choose "Cloudflare AI Gateway" from the "API Provider" dropdown.
3. **Enter Credentials:** Paste your Account ID, Gateway name, and API token into the corresponding fields.
4. **Select Model:** Choose your desired model from the "Model" dropdown.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Cloudflare AI Gateway. You'll be prompted for your Account ID, Gateway name, and API token.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Authenticate interactively, or set environment variables:

```bash
kilo auth cloudflare-ai-gateway
```

**Environment variables:**

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_GATEWAY_ID="your-gateway-name"
export CLOUDFLARE_API_TOKEN="your-api-token"
# Or, if you already use the alias:
# export CF_AIG_TOKEN="your-api-token"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "cloudflare-ai-gateway": {
      "env": [
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_GATEWAY_ID",
        "CLOUDFLARE_API_TOKEN",
      ],
    },
  },
}
```

Then set your default model (Unified API format `provider/model`):

```jsonc
{
  "model": "cloudflare-ai-gateway/anthropic/claude-sonnet-4-5",
}
```

{% /tab %}
{% /tabs %}

---

## Supported Models

Kilo Code uses the AI Gateway [Unified API](https://developers.cloudflare.com/ai-gateway/usage/unified-api/), so model IDs follow the format `provider/model`. The gateway exposes models from:

- **`openai/...`** — e.g. `openai/gpt-5.2-codex`, `openai/gpt-5.2`
- **`anthropic/...`** — e.g. `anthropic/claude-sonnet-4-5`, `anthropic/claude-opus-4`
- **`workers-ai/@cf/...`** — Cloudflare Workers AI models routed through your gateway, e.g. `workers-ai/@cf/moonshotai/kimi-k2.6`

The full list is fetched automatically from `models.dev`. For the authoritative supported-models reference, see the [Unified API docs](https://developers.cloudflare.com/ai-gateway/usage/unified-api/).

---

## Caching, Rate Limits, and Metadata

The AI Gateway provider supports a few extra knobs through the `options` block of your provider config:

```jsonc
{
  "provider": {
    "cloudflare-ai-gateway": {
      "options": {
        "cacheTtl": 3600,
        "cacheKey": "kilo-default",
        "skipCache": false,
        "collectLog": true,
        "metadata": { "team": "platform", "env": "dev" },
      },
    },
  },
}
```

These are forwarded to the gateway via the corresponding `cf-aig-*` headers. See the [Cloudflare AI Gateway configuration docs](https://developers.cloudflare.com/ai-gateway/configuration/) for the full set of options.

---

## Tips and Notes

- **Create the gateway first.** The Gateway Name is not auto-generated — you must visit **AI → AI Gateway → Create Gateway** in the Cloudflare dashboard and pick a name before this provider will work.
- **OpenAI reasoning models:** Kilo automatically drops the `maxOutputTokens` cap for OpenAI reasoning models (`gpt-5.x`, `o`-series) routed through the gateway, since the Unified API rejects `max_tokens` for those models. No action needed on your side.
- **Cost & analytics:** The dashboard shows per-model cost, token, and latency stats for every request that flows through the gateway.
- **Bring your own keys:** If you've configured upstream provider keys directly in the gateway settings, you don't need to set OpenAI/Anthropic/etc. keys in Kilo — the gateway uses its stored keys.
- **Direct Workers AI access:** If you only need Workers AI models and don't want a gateway in front, use the [Cloudflare Workers AI](/ai-providers/cloudflare-workers-ai) provider directly.
