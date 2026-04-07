---
title: "1Password Integration"
description: "Connect your KiloClaw agent to 1Password to securely manage credentials"
---

# 1Password Integration Guide

Connect your KiloClaw agent to 1Password to securely manage credentials. This allows your agent to fetch API keys or passwords without ever seeing them in plain text.

## Step 1: Create a Dedicated Vault

For maximum security, do not give the bot access to your personal vault.

1. Log in to your 1Password account.
2. Create a **New Vault** (e.g., name it `Kilo-Agent-Vault`).
3. Move only the specific items/keys you want the bot to use into this vault.

## Step 2: Generate a Service Account Token

1. Go to the [1Password Developer Portal](https://developer.1password.com/).
2. Select **Service Accounts** and click **Create a Service Account**.
3. **Important:** When prompted for permissions, select only the dedicated vault you created in Step 1.
4. Copy the generated token (it will begin with `ops_`).

## Step 3: Configure KiloClaw

1. Navigate to your KiloClaw dashboard: [app.kilo.ai/claw](https://app.kilo.ai/claw).
2. Go to **Settings > Tools** (or **Edit Files**).
3. Paste your `ops_` token into the **1Password Setup** field.
4. Click **Save**.

## Step 4: Activate the Integration

To apply the changes and inject the 1Password CLI into your environment:

1. Select **Upgrade to latest**.
2. Perform a **Redeploy** to restart the agent with the new permissions active.
