---
title: "Authentication"
description: "Learn how to authenticate with the Kilo AI Gateway using API keys, session tokens, and Bring Your Own Key (BYOK)."
---

# Authentication

The Kilo AI Gateway supports multiple authentication methods depending on your use case.

## API key authentication

The primary authentication method is a Bearer token passed in the `Authorization` header:

```bash
Authorization: Bearer <your_api_key>
```

API keys are JWT tokens tied to your Kilo account. See [how to get your API key](/docs/getting-started/setup-authentication#kilo-gateway-api-key) for step-by-step instructions.

### Using your API key

{% tabs %}
{% tab label="TypeScript" %}

```typescript
import { createOpenAI } from "@ai-sdk/openai"

const kilo = createOpenAI({
	baseURL: "https://api.kilo.ai/api/gateway",
	apiKey: process.env.KILO_API_KEY,
})
```

{% /tab %}
{% tab label="Python" %}

```python
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("KILO_API_KEY"),
    base_url="https://api.kilo.ai/api/gateway",
)
```

{% /tab %}
{% tab label="cURL" %}

```bash
curl -X POST "https://api.kilo.ai/api/gateway/chat/completions" \
  -H "Authorization: Bearer $KILO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "anthropic/claude-sonnet-4.5", "messages": [{"role": "user", "content": "Hello"}]}'
```

{% /tab %}
{% /tabs %}

## Organization tokens

When making requests on behalf of an organization, include the organization ID in the request header:

```
X-KiloCode-OrganizationId: your_org_id
```

Organization tokens are scoped with a 15-minute expiry and enforce the organization's policies, including model allow lists, provider restrictions, and per-user spending limits.

## Anonymous access

The gateway allows unauthenticated access for free models only. Anonymous requests are identified by IP address and are subject to rate limiting (200 requests per hour per IP).

Free models include models tagged with `:free` in their model ID, such as `minimax/minimax-m2.1:free` and `z-ai/glm-5:free`.

## Bring Your Own Key (BYOK)

BYOK lets you use your own provider API keys with the Kilo AI Gateway. When a BYOK key is configured, the gateway routes requests through Vercel AI Gateway using your key. You are billed directly by the provider -- Kilo does not add any markup.

### Supported BYOK providers

| Provider         | BYOK Key ID |
| ---------------- | ----------- |
| Anthropic        | `anthropic` |
| OpenAI           | `openai`    |
| Google AI Studio | `google`    |
| Mistral          | `mistral`   |
| MiniMax          | `minimax`   |
| xAI              | `xai`       |
| Z.AI             | `zai`       |
| Codestral (FIM)  | `codestral` |

### How BYOK works

1. Add your provider API key in the Kilo dashboard or through your Kilo Code extension settings
2. Keys are encrypted at rest using AES encryption
3. When you make a request for a model from that provider, the gateway automatically uses your key
4. Usage is tracked but not billed to your Kilo balance (cost is set to $0)
5. If your BYOK key fails, the request will not automatically fall back to Kilo's keys

### BYOK routing

When a BYOK key is detected, the request is routed through Vercel AI Gateway with your credentials:

```
Client → Kilo Gateway → Vercel AI Gateway (with your key) → Provider
```

This provides the benefit of Vercel's reliability infrastructure while using your own billing relationship with the provider.

## Request headers

The gateway accepts the following headers:

| Header                      | Required                | Description                                  |
| --------------------------- | ----------------------- | -------------------------------------------- |
| `Authorization`             | Yes (unless free model) | `Bearer <api_key>`                           |
| `Content-Type`              | Yes                     | `application/json`                           |
| `X-KiloCode-OrganizationId` | No                      | Organization context for org-scoped requests |
| `X-KiloCode-TaskId`         | No                      | Task identifier for prompt cache keying      |
| `X-KiloCode-Version`        | No                      | Client version string                        |
| `x-kilocode-mode`           | No                      | Mode hint for `kilo/auto` model routing      |
