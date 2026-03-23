---
title: "Connecting Chat Platforms"
description: "Connect your KiloClaw agent to Telegram, Discord, Slack, and more"
---

# Connecting Chat Platforms

KiloClaw supports connecting your AI agent to Telegram, Discord, and Slack. You can configure channels from the **Settings** tab on your [KiloClaw dashboard](/docs/kiloclaw/dashboard#channels), or from the OpenClaw Control UI after accessing your instance.

While the exact steps vary for configuring a chat platform (called a _channel_ by OpenClaw), the steps are to:

1. Configure the channel
2. Redeploy the KiloClaw instance
3. Initiate the pairing in the chat app
4. Accept the pairing request in the [KiloClaw UI](https://app.kilo.ai/claw)

Detailed instructions for supported chat apps are below.

## Chat Apps (Channels)

### Telegram

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to create your bot
3. Copy the **Bot Token** that BotFather gives you
4. Go to the **Settings** tab on your [KiloClaw dashboard](/docs/kiloclaw/dashboard)
5. Paste the token into the **Telegram Bot Token** field
6. Click **Save**
7. Redeploy your KiloClaw instance
8. Send a direct message to your bot in Telegram: `/start`

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
2. DM the bot `/pair`
3. You should get a response back with a pairing code
4. Return to [app.kilocode.ai/claw](https://app.kilocode.ai/claw) and confirm the pairing code and approve
5. You should now be able to chat with the bot from Discord

### Slack

#### Step 1: Create a Slack App from the OpenClaw Manifest

1. Go to [Slack App Management](https://api.slack.com/apps) and click **Create New App** → **From a Manifest**
2. Copy the manifest from the [OpenClaw docs](https://docs.openclaw.ai/channels/slack#manifest-and-scope-checklist)
3. Paste the manifest JSON into Slack's manifest editor
4. Customize the manifest before creating:
   - Rename the app to your preferred name wherever it appears
   - Update the slash command if desired (e.g., `/kiloclaw`)
5. Click **Create**

#### Step 2: Generate Tokens

You need two tokens from Slack:

**App-Level Token**

1. In your Slack app settings, scroll down to **App-Level Tokens**
2. Click **Generate Token**
3. Add the `connections:write` scope
4. Generate and copy the token (starts with `xapp-`)

**Bot User OAuth Token**

1. In the left sidebar, click **Install App**
2. Install the app to your workspace
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

#### Step 3: Connect Slack to KiloClaw

1. In the [KiloClaw UI](https://app.kilo.ai/claw), find the Slack integration section (may show "not configured")
2. Enter both tokens:
   - The `xapp-` app-level token
   - The `xoxb-` bot user OAuth token
3. Click **Save**
4. Scroll to the top of the KiloClaw UI and click **Redeploy**. Wait for the instance to come back up

#### Step 4: Pair Slack with KiloClaw

1. In Slack, DM the app and type your slash command (e.g., `/claw`) followed by anything — this triggers the pairing flow

> 📝 **Note**
> The slash command is whatever you defined in the manifest. Any text after the command will work to trigger pairing.

2. The app will return a pairing code
3. Return to [app.kilocode.ai/claw](https://app.kilocode.ai/claw) and confirm the pairing code and approve
4. You should now be able to chat with the bot from Slack

## Future Support

Additional platforms (such as WhatsApp) are planned for future releases. For the latest on supported platforms, refer to the [OpenClaw documentation](https://docs.openclaw.ai).

## Related

- [KiloClaw Overview](/docs/kiloclaw/overview)
- [Dashboard Reference](/docs/kiloclaw/dashboard)
- [Troubleshooting](/docs/kiloclaw/troubleshooting)
- [KiloClaw Pricing](/docs/kiloclaw/pricing)
- [OpenClaw Documentation](https://docs.openclaw.ai)
