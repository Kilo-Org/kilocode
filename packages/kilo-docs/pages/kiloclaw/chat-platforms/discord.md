---
title: "Discord"
description: "Use KiloClaw with Discord: setup, DM access control, and channel configuration"
---

# Discord

This page covers everything you need to use KiloClaw with Discord: connecting your bot, controlling who can DM it, and adding it to specific channels.

## Connecting KiloClaw to Discord

Create a bot in the Discord Developer Portal and link it to your KiloClaw dashboard.

## Prerequisites

Make sure you have a Discord server ready to add the bot to. If you don't have one, open Discord, scroll to the bottom of your server list, click **+**, choose **Create My Own**, then **For me and my friends**, and give it a name.

## Create an Application and Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and log in
2. Click **New Application**, give it a name, and click **Create**

## Enable Privileged Intents

On the **Bot** page, scroll down to **Privileged Gateway Intents** and enable:

- **Message Content Intent** (required)
- **Server Members Intent** (recommended — needed for role allowlists and name matching)
- **Presence Intent** (optional)

## Generate an Invite URL and Add the Bot to Your Server

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

## Copy Your Bot Token

1. Go back to the **Bot** page on the left sidebar and click **Reset Token**

> 📝 **Note**
> Despite the name, this generates your first token — nothing is being "reset."

2. Copy the token that appears and paste it into the **Discord Bot Token** field in your KiloClaw dashboard.

{% image src="/docs/img/kiloclaw/discord.png" alt="Connect account screen" width="800" caption="Discord bot token entry" /%}

Enter the token in the Settings tab and click **Save**. You can remove or replace a configured token at any time.

## Redeploy to Apply Changes

After saving your token, click **Redeploy** (the yellow button at the top of the KiloClaw dashboard) to apply the changes. The server will restart in about 30–45 seconds. Wait for the redeploy to complete before pairing.

## Start Chatting with the Bot

1. Right-click on the Bot in Discord and click **Message**
2. DM the bot `/pair`
3. You should get a response back with a pairing code
4. Return to [app.kilo.ai/claw](https://app.kilo.ai/claw) and confirm the pairing code and approve
5. You should now be able to chat with the bot from Discord

## Restricting KiloClaw to DMs Only (Just You)

By default, KiloClaw will respond to any DMs. To lock it down to only DMs with you:

### Step 1: Find your Discord user ID

1. In Discord, go to **User Settings** → **Advanced** → enable **Developer Mode**
2. Right-click your own avatar or username → **Copy User ID**

Your user ID is a large number (e.g. `987654321098765432`).

### Step 2: Configure DM-only access

Tell your KiloClaw agent (via DM):

> "Set Discord DM policy to allowlist with my user ID `987654321098765432` and disable guild responses."

Or configure it directly in the OpenClaw Control UI config:

```json
{
  "channels": {
    "discord": {
      "dmPolicy": "allowlist",
      "allowFrom": ["987654321098765432"],
      "groupPolicy": "disabled"
    }
  }
}
```

## Adding KiloClaw to a Specific Discord Channel

By default, your KiloClaw will not respond in channels, even if added. To have KiloClaw participate in a specific channel:

### Step 1: Get your server and channel IDs

With Developer Mode enabled (User Settings → Advanced → Developer Mode):

- Right-click the **server icon** → **Copy Server ID**
- Right-click the **channel name** in the sidebar → **Copy Channel ID**

### Step 2: Configure the channel

Tell your KiloClaw agent:

> "Add Discord server `YOUR_SERVER_ID` and channel `YOUR_CHANNEL_ID` to the allowlist. Only respond to user `YOUR_USER_ID`."

Or configure it directly:

```json
{
  "channels": {
    "discord": {
      "groupPolicy": "allowlist",
      "guilds": {
        "YOUR_SERVER_ID": {
          "requireMention": true,
          "users": ["YOUR_USER_ID"],
          "channels": {
            "YOUR_CHANNEL_ID": { "allow": true }
          }
        }
      }
    }
  }
}
```

Set `requireMention: false` if you want the bot to respond to every message without needing an @mention.

{% callout type="tip" %}
Non-listed channels in a guild that has a `channels` block configured are automatically denied. Add each channel you want explicitly. See the [OpenClaw Discord documentation](https://docs.openclaw.ai/channels/discord) for advanced access control options.
{% /callout %}
