---
title: "Bring Your Own Key (BYOK)"
description: "Use your own API keys with Kilo Gateway while retaining platform features"
---

# Bring Your Own Key (BYOK)

Bring Your Own Key (BYOK) lets you use your own API keys when using the Kilo Gateway, while retaining Kilo platform features like Code Reviews and Cloud Agents.

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
- Azure OpenAI
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

## Add a BYOK key

1. Log into the Kilo platform and select the account or organization you want to add the BYOK key to.
2. Navigate to the [Bring Your Own Key (BYOK) page](https://app.kilo.ai/byok), available in the sidebar under `Account`.
3. Click `Add Your First Key`, select the provider, and paste your API key.
4. Save.

### AWS Bedrock configuration

AWS Bedrock requires credentials as a JSON object rather than a single API key. Use exactly one of these two formats.

**Bedrock API key** — generate a key in the AWS Bedrock console, use a region where the key and model are available, and replace the key before it expires:

```json
{
  "apiKey": "...",
  "region": "us-east-1"
}
```

**IAM credentials** — use an IAM user or role:

```json
{
  "accessKeyId": "AKIA...",
  "secretAccessKey": "...",
  "region": "us-east-1"
}
```

| Field | Description |
|---|---|
| `apiKey` | Your Bedrock API key (API-key format only) |
| `accessKeyId` | Your AWS access key ID (IAM format only) |
| `secretAccessKey` | Your AWS secret access key (IAM format only) |
| `region` | The AWS region where Bedrock is enabled (e.g., `us-east-1`, `eu-west-1`) |

Don't mix fields from both formats in the same object.

An IAM user or role must have the following permissions:

- `bedrock:InvokeModel`
- `bedrock:InvokeModelWithResponseStream`

### Azure OpenAI configuration

Azure OpenAI requires your API key and resource name rather than a single key. Provide both as a JSON object:

```json
{
  "apiKey": "...",
  "resourceName": "my-azure-resource"
}
```

| Field | Description |
|---|---|
| `apiKey` | Your Azure OpenAI API key. |
| `resourceName` | The name of your Azure OpenAI resource, which is the subdomain of your endpoint URL. |

If your Azure deployment names differ from the model IDs you select in Kilo, add optional deployment mappings so each model resolves to its deployment.

## How Bring Your Own Key works

- When you use the **Kilo Gateway** provider, Kilo checks if there's a BYOK key for the selected model's provider.
- If a matching BYOK key exists, the request is routed using your key.
- If the key is invalid, the request fails. It does not fall back to using Kilo's keys.
- Subscription-based providers (such as the Z.ai Coding Plan or Kimi Code) only expose the models included in that plan. Select one of those models to route traffic through your subscription.

## Using BYOK in the Extensions and CLI

- BYOK works with the Kilo Gateway provider. Users should ensure that is set as the active [provider](/docs/ai-providers).
- Kilo Gateway models that can use one of your enabled personal or organization BYOK providers display a `BYOK` badge in the model picker. The badge does not apply to models selected through other providers.
- Select a model with the `BYOK` badge, for example Claude Sonnet 4.5 if you configured BYOK for Anthropic, or GLM-4.7 if you configured the Z.ai Coding Plan.
- (Optional) Validate with the provider that traffic is being served by that key.
