---
title: "Connecting Chat Platforms"
description: "Connect your KiloClaw agent to Telegram, Discord, Slack, and more"
---

# Connecting Chat Platforms

KiloClaw supports connecting your AI agent to Telegram, Discord, and Slack. You can configure channels from the **Settings** tab on your [KiloClaw dashboard](/docs/kiloclaw/dashboard#channels), or from the OpenClaw Control UI after accessing your instance.

## Supported Platforms

### Telegram

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to create your bot
3. Copy the **Bot Token** that BotFather gives you
4. Go to the **Settings** tab on your [KiloClaw dashboard](/docs/kiloclaw/dashboard)
5. Paste the token into the **Telegram Bot Token** field
6. Click **Save**
7. Redeploy your KiloClaw instance

{% image src="/docs/img/kiloclaw/telegram.png" alt="Connect account screen" width="800" caption="Telegram bot token entry" /%}

You can remove or replace a configured token at any time.

> ℹ️ **Info**
> Advanced settings such as DM policy, allow lists, and groups can be configured in the OpenClaw Control UI after connecting.

### Discord

To connect Discord, you need a **Bot Token** from the [Discord Developer Portal](https://discord.com/developers/applications).

#### Create an Application and Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and log in
2. Click **New Application**, give it a name, and click **Create**
3. Click **Bot** on the left sidebar
4. Click **Add Bot** and confirm

#### Enable Privileged Intents

On the **Bot** page, scroll down to **Privileged Gateway Intents** and enable:

- **Message Content Intent** (required)
- **Server Members Intent** (recommended — needed for role allowlists and name matching)
- **Presence Intent** (optional)

#### Copy Your Bot Token

1. Scroll back up on the **Bot** page and click **Reset Token**

> 📝 **Note**
> Despite the name, this generates your first token — nothing is being "reset."

2. Copy the token that appears and paste it into the **Discord Bot Token** field in your KiloClaw dashboard.

{% image src="/docs/img/kiloclaw/discord.png" alt="Connect account screen" width="800" caption="Discord bot token entry" /%}

Enter the token in the Settings tab and click **Save**. You can remove or replace a configured token at any time.

#### Generate an Invite URL and Add the Bot to Your Server

1. Click **OAuth2** on the sidebar
2. Scroll down to **OAuth2 URL Generator** and enable:
   - `bot`
   - `applications.commands`
3. A **Bot Permissions** section will appear below. Enable:
   - View Channels
   - Send Messages
   - Read Message History
   - Embed Links
   - Attach Files
   - Add Reactions (optional)
4. Copy the generated URL at the bottom
5. Paste it into your browser, select your server, and click **Continue**
6. You should now see your bot in the Discord server

#### Start Chatting with the Bot

1. Right-click on the Bot in Discord and click **Message**
2. DM the bot `/start` or `/restart`
3. You should get a response back with a pairing code
4. Return to [app.kilocode.ai/claw](https://app.kilocode.ai/claw) and confirm the pairing code and approve
5. You should now be able to chat with the bot from Discord

### Slack

To connect Slack, you need **both** of the following tokens from [Slack App Management](https://api.slack.com/apps):

- **Bot Token** — starts with `xoxb-`
- **App Token** — starts with `xapp-`

{% image src="/docs/img/kiloclaw/slack.png" alt="Connect account screen" width="800" caption="Slack bot and app token entry" /%}

Both tokens are required — you cannot save with only one.

## Configuring a Channel

1. Open your [KiloClaw dashboard](/docs/kiloclaw/dashboard)
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

- [KiloClaw Overview](/docs/kiloclaw/overview)
- [Dashboard Reference](/docs/kiloclaw/dashboard)
- [Troubleshooting](/docs/kiloclaw/troubleshooting)
- [KiloClaw Pricing](/docs/kiloclaw/pricing)
- [OpenClaw Documentation](https://docs.openclaw.ai)
