---
title: "Discord"
description: "Manage an existing KiloClaw Discord integration"
---

# Discord

> ⚠️ **Availability update**
> Discord is no longer available for new KiloClaw installations.
> 
> This page only applies if your instance already had Discord configured before it was removed for new installs.

If your instance already has Discord configured, you can continue using it and manage the bot setup in the KiloClaw dashboard.

## Existing Installation Prerequisites

Make sure you have a Discord server where your existing bot is already installed, or where you have permission to re-invite the same app if needed.

## Manage an Existing Bot Configuration

If you need to rotate credentials or verify configuration:

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and open your existing app
2. On the **Bot** page, review **Privileged Gateway Intents**:
   - **Message Content Intent** (required)
   - **Server Members Intent** (recommended — needed for role allowlists and name matching)
   - **Presence Intent** (optional)
3. If needed, click **Reset Token** and copy the new bot token
4. Paste the token into the **Discord Bot Token** field in your KiloClaw dashboard Settings
5. Click **Save**

{% image src="/docs/img/kiloclaw/discord.png" alt="Discord bot token entry in KiloClaw" width="800" caption="Discord bot token entry" /%}

## Redeploy to Apply Token Changes

After saving your token, click **Redeploy** from the KiloClaw dashboard to apply the change. The server typically restarts in about 30–45 seconds.

## Pairing and Verification

1. Right-click your bot in Discord and click **Message**
2. DM the bot `/pair`
3. Confirm the pairing code in [app.kilo.ai/claw](https://app.kilo.ai/claw)
4. Once approved, chat with the bot in Discord as usual

## Troubleshooting

If Discord is not already configured on your instance, the integration cannot be newly enabled.
Use [Slack](/docs/kiloclaw/chat-platforms/slack) or [Telegram](/docs/kiloclaw/chat-platforms/telegram) for new chat platform setups.
