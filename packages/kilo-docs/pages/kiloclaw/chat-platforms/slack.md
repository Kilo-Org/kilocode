---
title: "Slack"
description: "Using KiloClaw with Slack"
---

# Slack

This page covers everything you need to use KiloClaw with Slack: connecting your bot, controlling who can DM it, and adding it to channels.

## Connecting KiloClaw to Slack

{% youtube url="https://youtu.be/Q5bt-qH-_pY" title="Slack Setup Guide" caption="How to connect your KiloClaw agent to Slack" /%}

Create a Slack app from the OpenClaw manifest and link it to your KiloClaw dashboard.

### Step 1: Create a Slack App from the OpenClaw Manifest

1. Go to [Slack App Management](https://api.slack.com/apps) and click **Create New App** → **From a Manifest**
2. Copy the manifest from the [OpenClaw docs](https://docs.openclaw.ai/channels/slack#manifest-and-scope-checklist)
3. Paste the manifest JSON into Slack's manifest editor
4. Customize the manifest before creating:
   - Rename the app to your preferred name wherever it appears
   - Update the slash command if desired (e.g., `/kiloclaw`)
5. Click **Create**

### Step 2: Generate Tokens

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

### Step 3: Connect Slack to KiloClaw

1. In the [KiloClaw UI](https://app.kilo.ai/claw), find the Slack integration section (may show "not configured")
2. Enter both tokens:
   - The `xapp-` app-level token
   - The `xoxb-` bot user OAuth token
3. Click **Save**
4. Scroll to the top of the KiloClaw UI and click **Redeploy**. Wait for the instance to come back up

### Step 4: Pair Slack with KiloClaw

1. In Slack, DM the app and send any message — this triggers the pairing flow
2. The app will return a pairing code
3. Return to [app.kilo.ai/claw](https://app.kilo.ai/claw) and confirm the pairing code and approve
4. You should now be able to DM the bot from Slack. You will need to add the bot to any individual channels and tell it to update its config for any channels you want it to participate in.

## Changing Response Behavior

By default, KiloClaw can respond to any DMs and will not respond in Slack channels, even if added.

## Making KiloClaw DM-Only (from you)

By default, KiloClaw will respond to DMs from any user in Slack.

### Step 1: Find your Slack user ID

1. In Slack, click your name or profile picture
2. Click **Profile**
3. Click the **More** (⋯) menu → **Copy member ID**

Your user ID starts with `U` (e.g. `U12345678`).

### Step 2: Configure DM-only access

Tell your KiloClaw agent:

> "Set my Slack DM policy to allowlist with my user ID `U12345678` and disable group/channel responses."

Or configure it directly in the OpenClaw Control UI config:

```json
{
  "channels": {
    "slack": {
      "dmPolicy": "allowlist",
      "allowFrom": ["U12345678"],
      "groupPolicy": "disabled"
    }
  }
}
```

This allows only your user ID to DM the bot and blocks it from responding in any channels.

## Adding KiloClaw to a Slack Channel

By default, KiloClaw will not respond in Slack channels, even if added. To have KiloClaw participate in a Slack channel:

### Step 1: Invite the bot to the channel

1. Open the Slack channel where you want to add the bot
2. Type `/invite @YourBotName` (use whatever name you gave your app)
3. The bot should appear in the channel member list

### Step 2: Get the channel ID

Channel IDs are more reliable than names. To find a channel's ID:

1. Open the channel in Slack
2. Click the channel name at the top to open channel details
3. Scroll to the bottom — the channel ID starts with `C` (e.g. `C01234567`)

### Step 3: Configure the channel

Tell your KiloClaw agent (via DM):

> "Allow responses in Slack channel `C01234567`. Require an @mention to respond."

Or configure it directly:

```json
{
  "channels": {
    "slack": {
      "groupPolicy": "allowlist",
      "channels": {
        "C01234567": {
          "requireMention": true
        }
      }
    }
  }
}
```

Set `requireMention: false` if you want the bot to respond to every message in the channel without needing an @mention.

{% callout type="tip" %}
You can restrict which channel members can trigger the bot by adding a `users` allowlist inside the channel config entry. See the [OpenClaw Slack documentation](https://docs.openclaw.ai/channels/slack) for advanced access control options.
{% /callout %}
