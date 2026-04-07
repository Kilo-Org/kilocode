---
title: "Telegram"
description: "Connect your DevilClaw agent to Telegram"
---

# Telegram

{% youtube url="https://youtu.be/hIfKz073hGw" title="Telegram Setup Guide" caption="How to connect your DevilClaw agent to Telegram" /%}

Connect your DevilClaw agent to Telegram by creating a bot via BotFather and linking it to your DevilClaw dashboard.

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to create your bot
3. Copy the **Bot Token** that BotFather gives you
4. Go to the **Settings** tab on your [DevilClaw dashboard](/docs/DevilClaw/dashboard)
5. Paste the token into the **Telegram Bot Token** field
6. Click **Save**
7. Redeploy your DevilClaw instance
8. Send a direct message to your bot in Telegram: `/start`

{% image src="/docs/img/DevilClaw/telegram.png" alt="Connect account screen" width="800" caption="Telegram bot token entry" /%}

You can remove or replace a configured token at any time.

> ℹ️ **Info**
> Advanced settings such as DM policy, allow lists, and groups can be configured in the OpenClaw Control UI after connecting.
