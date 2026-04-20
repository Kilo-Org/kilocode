---
title: "Telegram"
description: "Use KiloClaw with Telegram: setup, DM access control, and group chat configuration"
---

# Telegram

This page covers everything you need to use KiloClaw with Telegram: connecting your bot and adding it to group chats.

## Connecting KiloClaw to Telegram

{% youtube url="https://youtu.be/hIfKz073hGw" title="Telegram Setup Guide" caption="How to connect your KiloClaw agent to Telegram" /%}

Create a bot via BotFather and link it to your KiloClaw dashboard.

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

## Adding KiloClaw to a Telegram Group Chat

By default, KiloClaw will not participate in a group chat, even if added. If you would like to use your KiloClaw in a group chat, you must configure the KiloClaw settings.

### Step 1: Add the bot to your group

1. Open the Telegram group where you want to add your bot
2. Tap the group name at the top to open group info
3. Tap **Add Members**
4. Search for your bot's username and add it

### Step 2: Set group visibility (Privacy Mode)

By default, Telegram bots only see messages that directly mention them. To allow your bot to see all group messages:

1. Open a chat with [@BotFather](https://t.me/BotFather)
2. Send `/setprivacy` and select your bot
3. Choose **Disable**
4. Remove the bot from the group and re-add it for the change to take effect

### Step 3: Get the group chat ID

You need the group's chat ID to configure access. Use one of these methods:

- Forward a message from the group to [@userinfobot](https://t.me/userinfobot) — it will show the chat ID
- Or run `openclaw logs --follow` after sending a message in the group and read the `chat.id` value

Group and supergroup IDs are negative numbers (e.g. `-1001234567890`).

### Step 4: Configure the group in OpenClaw

Tell your KiloClaw bot to add the group to its configuration. You can do this via DM:

> "Add Telegram group `-1001234567890` to my allowed groups. Require a @mention to respond."

Or configure it directly in the OpenClaw Control UI config:

```json
{
  "channels": {
    "telegram": {
      "groupPolicy": "allowlist",
      "groups": {
        "-1001234567890": {
          "requireMention": true
        }
      }
    }
  }
}
```

Set `requireMention: false` if you want the bot to respond to every message in the group without needing to be @mentioned.

{% callout type="tip" %}
To restrict which group members can trigger the bot, add your user IDs to `allowFrom` inside the group config. See the [OpenClaw groups documentation](https://docs.openclaw.ai/channels/groups) for advanced access control patterns.
{% /callout %}
