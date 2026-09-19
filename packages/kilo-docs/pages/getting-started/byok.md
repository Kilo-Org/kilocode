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

## Add a BYOK key

1. Log into the Kilo platform and select the account or organization you want to add the BYOK key to.
2. Navigate to the [Bring Your Own Key (BYOK) page](https://app.kilo.ai/byok), available in the sidebar under `Account`.
3. Click `Add Your First Key`, select the provider, and paste your API key.
4. Save.

### OpenAI (ChatGPT subscription)

The BYOK page also has an **OpenAI (ChatGPT subscription)** card for connecting without an API key. Choose **Sign in with ChatGPT** and complete the OpenAI consent flow; the card switches to a connected state. While the connection is enabled, eligible OpenAI model requests use your ChatGPT subscription ahead of other billing paths.

The connection belongs to the account you connect it from, not to your Kilo user account as a whole. Connecting on your personal account does not sign the subscription in for an organization, and connecting it to one organization does not connect it to another. To use the same subscription in more than one account, connect it separately from each account's BYOK page.

In an organization, the organization's BYOK page shows the ChatGPT card to every member so each member can connect their own subscription. Your connection is never shared with teammates: a member without their own connection keeps the normal gateway billing path. Managing pasted API keys for the organization still requires owner or billing manager access.

The models that the ChatGPT connection can serve show the `BYOK` badge in the model picker, the same as a pasted API key. Because those requests bill your ChatGPT plan rather than Kilo credits, they are not blocked by a zero Kilo credit balance. Abuse and organization policy checks still apply.

If the connection fails or expires, the card shows a readable message with a reconnect action. Use **Disconnect** to remove the stored connection for the account you are viewing: disconnecting on your personal BYOK page clears only the personal connection, while a connection you made for an organization is removed from that organization's BYOK page. The OpenAI API-key entry on the same page stays available and is labeled **OpenAI API key**.

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

- When you use the **Kilo Gateway** provider, Kilo checks if there's a BYOK key for the selected model's provider.
- If a matching BYOK key exists, the request is routed using your key.
- If the key is invalid, the request fails. It does not fall back to using Kilo's keys.
- Subscription-based providers (such as the Z.ai Coding Plan or Kimi Code) only expose the models included in that plan. Select one of those models to route traffic through your subscription.

## Using BYOK in the Extensions and CLI

- BYOK works with the Kilo Gateway provider. Users should ensure that is set as the active [provider](/docs/ai-providers).
- Kilo Gateway models that can use one of your enabled personal or organization BYOK providers display a `BYOK` badge in the model picker. The badge does not apply to models selected through other providers.
- Select a model with the `BYOK` badge, for example Claude Sonnet 4.5 if you configured BYOK for Anthropic, or GLM-4.7 if you configured the Z.ai Coding Plan.
- (Optional) Validate with the provider that traffic is being served by that key.
