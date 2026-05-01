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
- Fireworks
- Google AI Studio
- Inception
- Minimax
- Mistral AI
- Moonshot AI (Kimi)
- Novita
- OpenAI
- xAI
- Z.ai

### Subscription and direct provider plans

These providers offer coding-focused subscriptions or dedicated endpoints. Bring the API key issued by your plan to use its included models through the Kilo Gateway:

- BytePlus Coding Plan
- Chutes BYOK
- Kimi Code
- Mistral Codestral
- Neuralwatt
- Z.ai Coding Plan

## Add a BYOK key

1. Log into the Kilo platform and select the account or organization you want to add the BYOK key to.
2. Navigate to the [Bring Your Own Key (BYOK) page](https://app.kilo.ai/byok), available in the sidebar under `Account`.
3. Click `Add Your First Key`, select the provider, and paste your API key.
4. Save.

### AWS Bedrock configuration

AWS Bedrock requires credentials in a different format than other providers. Instead of a single API key, you must provide your AWS credentials as a JSON object:

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

## How Bring Your Own Key works

- When you use the **Kilo Gateway** provider, Kilo checks if there's a BYOK key for the selected model's provider.
- If a matching BYOK key exists, the request is routed using your key.
- If the key is invalid, the request fails. It does not fall back to using Kilo's keys.
- Subscription-based providers (such as the Z.ai Coding Plan or Kimi Code) only expose the models included in that plan. Select one of those models to route traffic through your subscription.

## Using BYOK in the Extensions and CLI

- BYOK works with the Kilo Gateway provider. Users should ensure that is set as the active [provider](/docs/ai-providers).
- Select a model from a provider configured for BYOK, for example Claude Sonnet 4.5 if you configured BYOK for Anthropic, or GLM-4.7 if you configured the Z.ai Coding Plan.
- (Optional) Validate with the provider that traffic is being served by that key.
