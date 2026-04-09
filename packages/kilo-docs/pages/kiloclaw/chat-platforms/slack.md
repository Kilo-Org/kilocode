---
title: "Slack"
description: "Connect your KiloClaw agent to Slack"
---

# Slack

{% youtube url="https://youtu.be/Q5bt-qH-_pY" title="Slack Setup Guide" caption="How to connect your KiloClaw agent to Slack" /%}

Connect your KiloClaw agent to Slack by creating a Slack app from the OpenClaw manifest and linking it to your KiloClaw dashboard.

## Step 1: Create a Slack App from the OpenClaw Manifest

1. Go to [Slack App Management](https://api.slack.com/apps) and click **Create New App** → **From a Manifest**
2. Copy the manifest from the [OpenClaw docs](https://docs.openclaw.ai/channels/slack#manifest-and-scope-checklist)
3. Paste the manifest JSON into Slack's manifest editor
4. Customize the manifest before creating:
   - Rename the app to your preferred name wherever it appears
   - Update the slash command if desired (e.g., `/kiloclaw`)
5. Click **Create**

## Step 2: Generate Tokens

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

## Step 3: Connect Slack to KiloClaw

1. In the [KiloClaw UI](https://app.kilo.ai/claw), find the Slack integration section (may show "not configured")
2. Enter both tokens:
   - The `xapp-` app-level token
   - The `xoxb-` bot user OAuth token
3. Click **Save**
4. Scroll to the top of the KiloClaw UI and click **Redeploy**. Wait for the instance to come back up

## Step 4: Pair Slack with KiloClaw

1. In Slack, DM the app and send any message — this triggers the pairing flow

2. The app will return a pairing code
3. Return to [app.kilocode.ai/claw](https://app.kilocode.ai/claw) and confirm the pairing code and approve
4. You should now be able to chat with the bot from Slack
