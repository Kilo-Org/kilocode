---
title: "Common Questions"
description: "Answers to common KiloClaw troubleshooting questions"
---

# Common Questions

## OpenClaw Doctor

OpenClaw Doctor is the recommended first step when something isn't working. It runs diagnostics on your instance and automatically fixes common configuration issues.

To use it:

1. Make sure your instance is running
2. Click **OpenClaw Doctor** on your [dashboard](/docs/kiloclaw/dashboard)
3. Watch the output as it runs — results appear in real time

## Does Redeploy reset my instance?

No. Redeploy does **not** delete your files, git repos, or cron jobs. It stops the machine, applies the latest platform image and your current configuration, and starts it again with the same persistent storage. Think of it as "update and restart."

## When should I use Restart OpenClaw vs Redeploy?

- **Restart OpenClaw** — Restarts just the OpenClaw process. The machine stays up. Use this for quick recovery from a process-level issue or when you want to apply openclaw config changes.
- **Redeploy** — Stops and restarts the entire machine with the latest image and config. Use this when the changelog shows a redeploy hint, or after changing channel tokens or secrets.

## My bot isn't responding on Telegram/Discord/Slack

1. Check that the channel token is configured in [Settings](/docs/kiloclaw/dashboard#channels)
2. Make sure you **Redeployed** or **Restarted OpenClaw** after saving tokens
3. Check for pending pairing requests — the user may need to be approved
4. Try running **OpenClaw Doctor**

## Accessing and Restoring Config Files

You can directly access the files in `/root/.openclaw/` on the [KiloClaw Dashboard](https://app.kilo.ai/claw) using the file browser of the edit files dialog. This can be a useful way to examine or update the config files (especially `openclaw.json`) if you run into an issue. There may also be backups in the form of `openclaw.bak` files that you can manually restore from if needed.

## The gateway shows "Crashed"

The OpenClaw process is automatically restarted when it crashes. Check the Gateway Process tab on your dashboard for the exit code and restart count. If it keeps crashing:

1. Run **OpenClaw Doctor**
2. Try a **Redeploy** to apply the latest platform image
3. If the issue persists, join the [Kilo Discord](https://kilo.ai/discord) and share details in the KiloClaw channel

## I changed the model but the agent is still using the old one

After selecting a new model, click **Save & Provision** to apply it. This refreshes the API key and saves the new model. You may also need to **Restart OpenClaw** for the change to take full effect.
