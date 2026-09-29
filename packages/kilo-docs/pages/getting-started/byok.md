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
- Google AI Studio
- Inception
- Minimax
- Mistral AI
- Moonshot AI (Kimi)
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
- Mistral Codestral
- Neuralwatt
- NVIDIA
- Ollama Cloud
- OpenCode Go
- OrcaRouter
- Synthetic
- Xiaomi Token Plan (Europe)
- Xiaomi Token Plan (Singapore)
- Z.ai Coding Plan

## Connect a ChatGPT subscription

Use **OpenAI (ChatGPT subscription)** to authorize subscription usage instead of adding an OpenAI API key:

1. Sign in to Kilo and select your personal account or the organization where you will use the subscription.
2. Open the [BYOK page](https://app.kilo.ai/byok) and find **OpenAI (ChatGPT subscription)**.
3. Choose **Sign in with ChatGPT**, sign in to OpenAI, and approve the subscription permissions.
4. Return to BYOK and confirm **Connected** and the expected account. Use the **Kilo Gateway** provider with a supported OpenAI model.

Signing in to Kilo with ChatGPT does not complete this connection. You can also connect a subscription if you use another method to sign in to Kilo.

This option is not available for every Kilo account yet. If the subscription card is missing, you can still use a supported provider API key.

Personal connections do not apply to organization requests. In an organization, each member connects their own account; owners and admins can also configure a separate shared-services connection for organization automation.

{% callout type="warning" %}
Only eligible requests use your ChatGPT allowance. Other requests, and some connection failures, use normal Gateway routing and may charge your saved provider key or Kilo credits. Cloud compute is charged separately. The API-key failure behavior described below is not a guarantee for ChatGPT connections.
{% /callout %}

See [ChatGPT subscription setup](/docs/ai-providers/openai-chatgpt-plus-pro#connect-your-subscription-to-kilo) for model support, usage limits, and connection management.

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
- If a matching BYOK key exists and the request is not served by a connected ChatGPT subscription, the request is routed using your key.
- If the key is invalid, the request fails. It does not fall back to using Kilo's keys.
- Subscription-based providers (such as the Z.ai Coding Plan or Kimi Code) only expose the models included in that plan. Select one of those models to route traffic through your subscription.

## Using BYOK in the Extensions and CLI

- BYOK works with the Kilo Gateway provider. Users should ensure that is set as the active [provider](/docs/ai-providers).
- Kilo Gateway models that can use one of your enabled personal or organization BYOK providers display a `BYOK` badge in the model picker. The badge does not apply to models selected through other providers.
- Select a model with the `BYOK` badge, for example Claude Sonnet 4.5 if you configured BYOK for Anthropic, or GLM-4.7 if you configured the Z.ai Coding Plan.
- (Optional) Validate with the provider that traffic is being served by that key.
