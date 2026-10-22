---
sidebar_label: Cloudflare
---

# Using Cloudflare With Kilo Code

Kilo Code supports both Cloudflare Workers AI and Cloudflare AI Gateway. Workers AI runs Cloudflare-hosted models directly, while AI Gateway routes requests through your Cloudflare gateway to one or more upstream providers.

**Website:** [https://developers.cloudflare.com/ai/](https://developers.cloudflare.com/ai/)

## Provider Options

| Provider ID | Use it for | Required values |
|---|---|---|
| `cloudflare-workers-ai` | Cloudflare-hosted Workers AI models | Account ID and API key |
| `cloudflare-ai-gateway` | Routing through Cloudflare AI Gateway | Account ID, Gateway ID, and Gateway API token |

You can enter these values interactively with `/connect` in the TUI or `kilo auth` from the CLI, or provide them through environment variables.

## Cloudflare Workers AI

### Get Credentials

1. Open the Cloudflare dashboard and select your account.
2. Copy the **Account ID** from the dashboard.
3. Create an API token that can invoke Workers AI.

### Configure Kilo

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Cloudflare Workers AI. If your account ID is not already available from the environment, Kilo prompts for it while connecting the provider.

{% /tab %}
{% tab label="CLI" %}

Use `/connect` in the TUI and choose Cloudflare Workers AI, or run:

```bash
kilo auth cloudflare-workers-ai
```

Alternatively, set environment variables before launching Kilo:

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_API_KEY="your-workers-ai-api-key"
```

Then choose a Workers AI model from the model picker, or set a default model such as:

```jsonc
{
  "model": "cloudflare-workers-ai/@cf/meta/llama-3.1-8b-instruct"
}
```

{% /tab %}
{% /tabs %}

## Cloudflare AI Gateway

### Get Credentials

1. Create or open a Cloudflare AI Gateway.
2. Copy your **Account ID** and **Gateway ID**.
3. Create a Gateway API token.

### Configure Kilo

{% tabs %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add Cloudflare AI Gateway. Kilo prompts for the account ID and gateway ID when they are not already set in the environment.

{% /tab %}
{% tab label="CLI" %}

Use `/connect` in the TUI and choose Cloudflare AI Gateway, or run:

```bash
kilo auth cloudflare-ai-gateway
```

Alternatively, set environment variables before launching Kilo:

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_GATEWAY_ID="your-gateway-id"
export CLOUDFLARE_API_TOKEN="your-gateway-api-token"
```

`CF_AIG_TOKEN` is also accepted as an alternative to `CLOUDFLARE_API_TOKEN`.

Then choose a gateway-backed model from the model picker, or set a default model such as:

```jsonc
{
  "model": "cloudflare-ai-gateway/openai/gpt-5.1"
}
```

{% /tab %}
{% /tabs %}

## Advanced Configuration

If your organization provides a fully configured gateway URL, set `provider.<id>.options.baseURL`. When `baseURL` is configured, Kilo skips the built-in Account ID and Gateway ID checks because the URL already identifies the target service.

```jsonc
{
  "provider": {
    "cloudflare-ai-gateway": {
      "options": {
        "baseURL": "https://gateway.example.com/v1"
      }
    }
  }
}
```

## Troubleshooting

- **`CLOUDFLARE_ACCOUNT_ID is missing`** — set `CLOUDFLARE_ACCOUNT_ID` or reconnect the provider with `/connect` so Kilo can store the account ID in auth metadata.
- **`CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_GATEWAY_ID missing`** — set both values or run `kilo auth cloudflare-ai-gateway`.
- **`CLOUDFLARE_API_TOKEN (or CF_AIG_TOKEN) is required`** — set one of those variables or reconnect Cloudflare AI Gateway with `kilo auth cloudflare-ai-gateway`.
- **Model errors through AI Gateway** — confirm the gateway route supports the selected upstream provider/model and that your Gateway API token has access.
