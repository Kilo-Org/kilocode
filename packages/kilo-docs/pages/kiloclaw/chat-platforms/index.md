---
title: "Chat Platforms"
description: "Use Kilo Chat or connect your KiloClaw agent to Telegram, Discord, and Slack"
---

# Chat Platforms

KiloClaw includes Kilo Chat as its first-party channel and also supports connecting your AI agent to messaging platforms so it can receive instructions and send responses directly in your chat apps. You can configure third-party channels from the **Settings** tab on your [KiloClaw dashboard](/docs/kiloclaw/dashboard#channels), or from the OpenClaw Control UI after accessing your instance.

## Kilo Chat

Kilo Chat is the zero-setup, first-party channel for KiloClaw. It is enabled by default, does not require a per-sandbox channel token, and is available from the Kilo web and mobile apps as well as supported Kilo Code editor and TUI surfaces.

Use Kilo Chat when you want to talk to your Claw without configuring a separate bot or app in another messaging platform. For external team chat tools, use one of the third-party channels below.

## Third-Party Platforms

The general steps to connect a third-party chat platform are:

1. Configure the channel token in Settings
2. Redeploy the KiloClaw instance
3. Initiate the pairing in the chat app
4. Accept the pairing request in the [KiloClaw UI](https://app.kilo.ai/claw)

## Supported Platforms

- [**Kilo Chat**](https://app.kilo.ai) — Use the built-in first-party channel with no token setup.
- [**Telegram**](/docs/kiloclaw/chat-platforms/telegram) — Connect via a BotFather bot token.
- [**Discord**](/docs/kiloclaw/chat-platforms/discord) — Connect via a Discord Developer Portal bot token.
- [**Slack**](/docs/kiloclaw/chat-platforms/slack) — Connect via a Slack app manifest with app-level and bot tokens.
