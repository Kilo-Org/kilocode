---
title: "Using ChatGPT subscriptions with Kilo Code"
description: "Sign in to Kilo with ChatGPT, connect your subscription through BYOK, or use OpenAI directly in VS Code and the CLI. Learn how setup, limits, and billing work."
sidebar_label: ChatGPT Plus/Pro
---

# Using ChatGPT subscriptions with Kilo Code

You can use your ChatGPT account to sign in to Kilo and your subscription to run supported OpenAI models. Signing in and connecting your subscription are separate steps, explained below. Neither requires an OpenAI API key.

OpenAI controls which models and how much usage your plan includes. Check [OpenAI's current plan details](https://developers.openai.com/codex/pricing/) for eligibility and limits.

{% callout type="info" %}
An [OpenAI API key](/docs/ai-providers/openai) uses separate OpenAI Platform billing. It does not spend your ChatGPT subscription allowance.
{% /callout %}

## Sign in to Kilo with ChatGPT

1. Open [Kilo](https://app.kilo.ai) and enter your email address when prompted.
2. Choose **Sign in with ChatGPT** if it is available for your account.
3. Sign in to OpenAI, review the permissions shown, and return to Kilo.

To use your subscription for model requests, complete the BYOK connection below as well. You do not have to use ChatGPT as your Kilo login method: if you already use email, GitHub, or another method, sign in as usual and connect your subscription from BYOK.

{% callout type="note" %}
ChatGPT sign-in and the BYOK subscription connection are not available for every Kilo account yet. If the option is missing after you enter your email or sign in, this does not necessarily mean your ChatGPT plan is unsupported. Continue with another sign-in method or provider.
{% /callout %}

## Connect your subscription to Kilo

Use this connection for supported requests through the [Kilo Gateway](/docs/gateway), rather than configuring OpenAI separately on each device.

1. Sign in to Kilo and select the personal account or organization where you want to use the subscription.
2. Open the [Bring Your Own Key (BYOK) page](https://app.kilo.ai/byok).
3. Find **OpenAI (ChatGPT subscription)** and choose **Sign in with ChatGPT**. Do not paste an API key into the OpenAI API-key form.
4. Sign in to the OpenAI account you want to use and approve the subscription permissions. This approval is separate from permission to sign in to Kilo.
5. Return to BYOK and confirm that the card shows **Connected** and the expected account next to **Connected as**.

### Personal and organization connections

Connect in the same account context where you will run your tasks:

- **Personal account:** The connection applies to your personal Kilo usage. It does not carry over to organization requests.
- **Organization:** Each member can connect their own ChatGPT account for their own usage in that organization. Connecting yours does not share it with every member.
- **Organization shared services:** Owners and admins can use **OpenAI (ChatGPT) for shared services** and choose **Connect an OpenAI account**. This connection is for eligible automation requests, such as Code Reviews or the Slack bot, rather than every member's chats. It can consume the connected ChatGPT account's allowance.

Connect separately for each organization where you need access. If you connect the same ChatGPT subscription in multiple places, those connections still use the same OpenAI account's allowance; connecting again does not give you a separate quota.

### Choose a model

In VS Code or the CLI, sign in to the same Kilo account and use the **Kilo Gateway** provider. For Cloud Agents, use the account or organization where you connected the subscription.

{% callout type="tip" title="Look for the BYOK badge" %}
After you connect your ChatGPT subscription, supported OpenAI models should be marked **BYOK** in the model picker. Choose one of these models to use your subscription. If the badge is missing, check that your connection shows **Connected** on the BYOK page for the account or organization you are using.
{% /callout %}

The subscription does not cover every OpenAI model or every kind of request. Kilo uses OpenAI's available-model list to determine eligible models; GPT-OSS models are not included in this route. For API integrations, the subscription route supports the **Responses API**, not Chat Completions requests.

For eligible requests, Kilo tries the connected ChatGPT subscription before a saved OpenAI API key.

### Costs and usage limits

Requests served through the subscription use your ChatGPT allowance rather than Kilo credits for model inference. Other costs are separate: [Cloud Agent compute](/docs/code-with-ai/platforms/cloud-agent#cost), Kilo Deploy, and other paid services are not included in your ChatGPT subscription.

{% callout type="warning" title="A connection is not a spending cap" %}
Requests that are not eligible for the subscription use normal Gateway routing. Some temporary connection failures can also fall back to normal routing. Depending on your configuration, those requests can use a saved provider API key or Kilo credits. Do not assume every OpenAI request is covered just because a subscription is connected.
{% /callout %}

If OpenAI rejects a request because you reached your ChatGPT usage limit, Kilo does not automatically retry that request using a saved API key or Kilo credits. Open BYOK and use **Manage usage** to check your allowance and reset time. Wait for the limit to reset, or disconnect the applicable subscription connection to use your usual paid route. Buying Kilo credits alone does not switch a connected request away from ChatGPT.

### Manage the connection

Return to the BYOK page in the account or organization where you connected:

- **Connected:** Use **View and manage your ChatGPT usage** to open OpenAI's usage settings. Kilo's usage-limit notice reports a recent limit error; it is not a live remaining-quota meter.
- **Needs reconnect:** Choose **Reconnect with ChatGPT** and approve access again. Shared-services connections use **Reconnect**. Kilo normally refreshes access automatically, but an expired or revoked connection can require another sign-in.
- **Disconnect:** Removes that subscription connection from Kilo. It does not cancel your ChatGPT subscription or remove ChatGPT as a Kilo login method. Subsequent requests may use a saved API key or Kilo credits.

Signing out of Kilo does not disconnect your subscription. Manage each personal, organization-member, and shared-services connection separately.

### What you authorize

The browser-based authorization uses OAuth: you sign in on OpenAI's site rather than giving Kilo your ChatGPT password. The BYOK flow asks for permission to use your allowance and renew access without asking you to sign in for every request.

Kilo stores the connection credentials encrypted. Requests and their code context pass through the Kilo Gateway before reaching OpenAI. This is not a local-only connection or a promise of zero data retention; review the applicable Kilo and OpenAI privacy terms before using sensitive code.

## Connect directly in VS Code or the CLI

Use this option when you want the local OpenAI provider to use your subscription directly, without the Kilo Gateway. It does not create a BYOK connection for Cloud Agents.

{% tabs %}
{% tab label="VS Code" %}

Open **Settings** (gear icon) and go to the **Providers** tab. Choose OpenAI and follow the ChatGPT sign-in flow to connect your subscription.

If OpenAI is already connected from an API key, environment variable, or `kilo.json` config, you can still sign in with ChatGPT from the OpenAI provider row. Kilo Code uses the ChatGPT sign-in for Codex models until you disconnect it, then falls back to your existing OpenAI API configuration.

{% /tab %}
{% tab label="CLI" %}

Run the auth command and follow the ChatGPT Plus/Pro sign-in flow:

```bash
kilo auth login --provider codex
```

You can also use `--provider openai`. If you already have `OPENAI_API_KEY` or OpenAI config set, ChatGPT OAuth takes priority for Codex models until you log out of the OpenAI provider.

Then set your default model to one of the OpenAI Codex models available in Kilo Code:

```jsonc
{
  "model": "openai/gpt-5.1-codex",
}
```

{% /tab %}
{% /tabs %}

## Check local Codex usage

When you connect the local OpenAI provider with ChatGPT, Kilo reports your Codex quota alongside your other connected providers:

- **VS Code:** open the **Profile** view and find the **Plans & usage** section.
- **CLI:** run `/usage` (aliases `/plans` and `/quota`) and press `ctrl+r` to refresh.

Codex shows its plan and each usage window — for example, a five-hour and a weekly limit — with the percentage used and the reset time. The **Manage** link opens your Codex usage settings at chatgpt.com. If your ChatGPT sign-in has expired, you can reconnect from the provider settings.

The local provider only exposes models in Kilo Code's Codex catalog, not every model available through the OpenAI API.

## Troubleshooting

**I signed in with ChatGPT, but my subscription is not connected.**
Kilo account login and subscription authorization are separate. Open BYOK in the correct personal account or organization and connect **OpenAI (ChatGPT subscription)**.

**My personal connection does not work in an organization.**
Switch to that organization and connect your ChatGPT account on its BYOK page. Your personal connection is not reused for organization traffic.

**The connection attempt timed out or failed.**
Return to the correct BYOK page and choose **Try again**. Complete OpenAI's consent flow without leaving it open for more than 15 minutes. If the card cannot load your connection status, **Try again** reloads it.

**I reconnected, but OpenAI still says I reached my limit.**
Reconnecting renews access; it does not replenish your subscription allowance. Check **Manage usage** for the limit and reset time.

**I want to use a different ChatGPT account.**
Disconnecting BYOK alone does not remove the ChatGPT identity linked to your Kilo login. Kilo allows one linked ChatGPT identity per user. Check **Connected Accounts** before trying to link another identity, and make sure you have another sign-in method available before unlinking your current one.

**My local browser sign-in fails with a CSRF or callback error.**
The direct VS Code and CLI flow uses local port `1455`. Check that another application is not using it. On macOS or Linux, run `lsof -i :1455`. This does not apply to the dashboard BYOK flow.

**How do I disconnect the local provider?**
In VS Code, choose **Disconnect** in the provider settings. In the CLI, run `kilo auth logout` and choose OpenAI. This is separate from managing the connection on Kilo's BYOK page.

You can still switch to another provider or an API-key configuration. Check that provider's billing before sending requests.
