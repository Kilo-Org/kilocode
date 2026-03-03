---
title: "Connecting Chat Platforms"
description: "Connect your KiloClaw agent to Telegram, Discord, Slack, and more"
---

# Connecting Chat Platforms

KiloClaw supports connecting your AI agent to Telegram, Discord, and Slack. You can configure channels from the **Settings** tab on your [KiloClaw dashboard](/docs/automate/kiloclaw/dashboard#channels), or from the OpenClaw Control UI after accessing your instance.

## Supported Platforms

### Telegram

To connect Telegram, you need a **Bot Token** from [@BotFather](https://t.me/BotFather) on Telegram.

Enter the token in the Settings tab and click **Save**. You can remove or replace a configured token at any time.

{% image src="/docs/img/kiloclaw/telegram.png" alt="Connect account screen" width="800" caption="Telegram bot token entry" /%}

Advanced settings such as DM policy, allow lists, and groups can be configured in the OpenClaw Control UI after connecting.

### Discord

To connect Discord, you need a **Bot Token** from the [Discord Developer Portal](https://discord.com/developers/applications).

{% image src="/docs/img/kiloclaw/discord.png" alt="Connect account screen" width="800" caption="Discord bot token entry" /%}

Enter the token in the Settings tab and click **Save**. You can remove or replace a configured token at any time.

### Slack

To connect Slack, you need **both** of the following tokens from [Slack App Management](https://api.slack.com/apps):

- **Bot Token** — starts with `xoxb-`
- **App Token** — starts with `xapp-`

{% image src="/docs/img/kiloclaw/slack.png" alt="Connect account screen" width="800" caption="Slack bot and app token entry" /%}

Both tokens are required — you cannot save with only one.

## Configuring a Channel

1. Open your [KiloClaw dashboard](/docs/automate/kiloclaw/dashboard)
2. Go to the **Settings** tab
3. Scroll to the **Channels** section
4. Enter the required token(s) for your platform
5. Click **Save**

{% callout type="info" %}
After saving channel tokens, you need to **Redeploy** or **Restart OpenClaw** for the changes to take effect.
{% /callout %}

To remove a channel, clear its token(s) in Settings and save. Redeploy or Restart OpenClaw afterward to apply the removal.

## Pairing Requests

After connecting a channel and starting your instance, new users and devices need to be approved before they can interact with your agent.

- **Channel pairing** — When someone messages your bot on Telegram, Discord, or Slack for the first time, a pairing request appears on your dashboard. You need to click **Approve** to allow them to use the bot.
- **Device pairing** — When a new browser or device connects to the OpenClaw Control UI, a similar request appears. Click **Approve** to authorize it.

{% callout type="note" %}
Pairing data is cached for about 2 minutes. Use the refresh button to check for new requests.
{% /callout %}

## Future Support

Additional platforms (such as WhatsApp) are planned for future releases. For the latest on supported platforms, refer to the [OpenClaw documentation](https://docs.openclaw.ai).

## Related

- [KiloClaw Overview](/docs/automate/kiloclaw/overview)
- [Dashboard Reference](/docs/automate/kiloclaw/dashboard)
- [Troubleshooting](/docs/automate/kiloclaw/troubleshooting)
- [KiloClaw Pricing](/docs/automate/kiloclaw/pricing)
- [OpenClaw Documentation](https://docs.openclaw.ai)
