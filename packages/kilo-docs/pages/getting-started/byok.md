---
title: "Bring Your Own Key (BYOK)"
description: "Use your own API keys or connect a ChatGPT subscription with Kilo Gateway while retaining platform features"
---

# Bring Your Own Key (BYOK)

Bring Your Own Key (BYOK) lets you use your own API keys when using the Kilo Gateway, while retaining Kilo platform features like Code Reviews and Cloud Agents.

You can also connect a ChatGPT subscription from this page without an API key. [ChatGPT connections](/docs/getting-started/byok#connect-a-chatgpt-subscription) and [provider API keys](/docs/getting-started/byok#add-a-byok-key) have different setup and billing behavior.

A user or organization may want to use BYOK to:

- Utilize new models quickly, Kilo Gateway supports most new models in minutes
- Use subscriptions with third-party AI providers, for example the [Z.ai Coding Plan](https://z.ai/subscribe), [Kimi Code](https://platform.moonshot.ai/), or the [BytePlus Coding Plan](https://www.byteplus.com/)
- Attribute usage against existing provider commitments or agreements
- Use existing credits with a provider

## Supported BYOK providers

Kilo Gateway supports BYOK keys for these providers.

### Standard API keys

Use your provider API key to route matching models through your account:

- Anthropic
- AWS Bedrock
- Azure Foundry (experimental)
- DeepSeek
- Fireworks
- GMI Cloud
- Google AI Studio
- Inception
- Minimax
- Mistral AI
- Moonshot AI (Kimi)
- Nebius Token Factory
- Novita
- OpenAI
- Xiaomi
- SpaceXAI
- Z.ai

### Subscription and direct provider plans

These providers offer coding-focused subscriptions or dedicated endpoints. Bring the API key issued by your plan to use its included models through the Kilo Gateway:

- BytePlus Coding Plan
- Chutes BYOK
- CrofAI
- Inceptron BYOK
- Kimi Code
- Martian
- Neuralwatt
- NVIDIA
- Ollama Cloud
- OpenCode Go
- OrcaRouter
- Synthetic
- Xiaomi Token Plan (Europe)
- Xiaomi Token Plan (Singapore)
- Z.ai Coding Plan

### Gateway keys

These keys route through a gateway that already serves the regular Kilo catalog models, so no separate model entries are needed. Save the gateway's own API key:

- OpenRouter
- Vercel AI Gateway

A gateway key serves the catalog models its gateway provides. If you save both keys, the Vercel AI Gateway key is used for the models it serves, and the OpenRouter key covers requests that Vercel cannot serve.

## Connect a ChatGPT subscription

Connect **OpenAI (ChatGPT subscription)** on the [BYOK page](https://app.kilo.ai/byok) to use your subscription allowance for supported OpenAI models through the Kilo Gateway. No OpenAI API key is needed.

See [ChatGPT subscription setup](/docs/ai-providers/openai-chatgpt-plus-pro#connect-your-subscription-to-kilo) for connection steps, personal and organization scope, and billing details.

## Add a BYOK key

1. Log into the Kilo platform and select the account or organization you want to add the BYOK key to.
2. Navigate to the [Bring Your Own Key (BYOK) page](https://app.kilo.ai/byok), available in the sidebar under `Account`.
3. Click `Add Your First Key`, select the provider, and paste your API key.
4. Save.

### AWS Bedrock configuration

AWS Bedrock requires JSON credentials. Use one of these two formats; don't mix fields from both.

**Bedrock API key:** Generate a key in the AWS Bedrock console and use a region where the key and model are available. Replace the key before it expires.

```json
{
  "apiKey": "...",
  "region": "us-east-1"
}
```

**IAM credentials:**

```json
{
  "accessKeyId": "AKIA...",
  "secretAccessKey": "...",
  "region": "us-east-1"
}
```

| Field | Description |
|---|---|
| `accessKeyId` | Your AWS access key ID |
| `secretAccessKey` | Your AWS secret access key |
| `region` | The AWS region where Bedrock is enabled (e.g., `us-east-1`, `eu-west-1`) |

Your IAM user or role must have the following permissions:

- `bedrock:InvokeModel`
- `bedrock:InvokeModelWithResponseStream`

### Azure Foundry configuration

Select **Azure Foundry (experimental)** and enter JSON credentials. Use `resourceName` for the subdomain of your endpoint, such as `my-resource` from `my-resource.openai.azure.com`:

```json
{
  "apiKey": "...",
  "resourceName": "my-resource"
}
```

If your deployment names differ from the gateway model IDs, add `modelMappings` to map each model to its Azure deployment:

```json
{
  "apiKey": "...",
  "resourceName": "my-resource",
  "modelMappings": [
    {
      "gatewayModelSlug": "openai/gpt-5.4-nano",
      "customModelId": "my-gpt-5-4-nano-deployment"
    }
  ]
}
```

## How Bring Your Own Key works

These rules apply to saved API keys. Eligible requests use a connected ChatGPT subscription first.

- When you use the **Kilo Gateway** provider, Kilo checks if there's a BYOK key for the selected model's provider.
- If a matching BYOK key exists and the request is not served by a connected subscription like ChatGPT, the request is routed using your key.
- If the key is invalid, the request fails. It does not fall back to using Kilo's keys.
- Subscription-based providers (such as the Z.ai Coding Plan or Kimi Code) only expose the models included in that plan. Select one of those models to route traffic through your subscription.

## Preview the routes a model uses

When you have at least one saved key, a **Routing preview** appears below the key list on the [BYOK page](https://app.kilo.ai/byok) and in the organization BYOK settings. Pick a catalog model and an API kind (default: Chat Completions) to see the routes a request would try, in order, and why each one is used or skipped:

1. Direct BYOK keys whose provider serves the model, tried in Kilo's provider order. A key is skipped when its upstream does not offer the selected API kind, when the key is disabled, or when it uses provider model IDs instead of catalog IDs.
2. Your [ChatGPT connection](#connect-a-chatgpt-subscription) for eligible OpenAI models over the Responses API. The step is conditional because the connection is personal and its state is encrypted, so the preview cannot confirm it is active.
3. Vercel BYOK inference-provider keys, sent together through Vercel AI Gateway. Disabled keys are listed as skipped.
4. Your Vercel AI Gateway and OpenRouter keys, skipped when the key is disabled, when a provider key is preferred, or when the gateway does not serve the model.
5. Kilo's own route, through Vercel AI Gateway or OpenRouter, paid with Kilo credits.

Steps below the one that serves the request, including a conditional ChatGPT step, are shown as **Not tried**. When no catalog-mode key serves the model, the preview shows the unsupported-API failure instead. Organization model and provider policies still apply. Changing a key on the page refreshes the preview.

The preview reads your key metadata only. It never decrypts a key or calls the provider.

## Serve Kilo catalog model IDs (catalog mode)

By default, a provider key serves models under that provider's own IDs. You can switch a key to serve Kilo catalog model IDs instead by turning on **Use Kilo catalog model IDs** when you add or edit the key.

Catalog mode is off by default for new and existing keys. It is offered only for providers that map at least one model to a catalog ID, and it is not available for Vercel BYOK keys or for the OpenRouter and Vercel AI Gateway keys.

With catalog mode on:

- The key serves catalog model IDs such as `moonshotai/kimi-k2.6`, and its supported models list shows those IDs. The provider-prefixed IDs are no longer served by the key.
- [Auto Model](/docs/code-with-ai/agents/auto-model) and custom routers can route matching catalog models through the key. For the catalog models it serves, the key is used ahead of a ChatGPT connection and your other BYOK keys.
- Organization model restrictions apply to requests that use the key. Keys without catalog mode keep their provider-prefixed IDs and stay exempt from those restrictions.

Saved favorites are not rewritten when you switch a key to catalog mode. A saved model that used the provider-prefixed ID fails with a message naming the catalog ID to use; select the catalog model instead.

Personal key owners can change catalog mode. For organization keys, only organization owners and admins can.

## Using BYOK in the Extensions and CLI

- BYOK works with the Kilo Gateway provider. Users should ensure that is set as the active [provider](/docs/ai-providers).
- Kilo Gateway models that can use one of your enabled personal or organization BYOK providers display a `BYOK` badge in the model picker. The badge does not apply to models selected through other providers.
- Select a model with the `BYOK` badge, for example Claude Sonnet 4.5 if you configured BYOK for Anthropic, or GLM-4.7 if you configured the Z.ai Coding Plan.
- (Optional) Validate with the provider that traffic is being served by that key.
