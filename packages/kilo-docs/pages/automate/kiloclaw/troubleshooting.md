---
title: "Troubleshooting"
description: "Common issues, diagnostics, and FAQ for KiloClaw instances"
---

# Troubleshooting

## OpenClaw Doctor

OpenClaw Doctor is the recommended first step when something isn't working. It runs diagnostics on your instance and automatically fixes common configuration issues.

To use it:

1. Make sure your instance is running
2. Click **OpenClaw Doctor** on your [dashboard](/docs/automate/kiloclaw/dashboard)
3. Watch the output as it runs — results appear in real time

## Common Questions

### Does Redeploy reset my instance?

No. Redeploy does **not** delete your files, git repos, or cron jobs. It stops the machine, applies the latest platform image and your current configuration, and starts it again with the same persistent storage. Think of it as "update and restart."

### When should I use Restart OpenClaw vs Redeploy?

- **Restart OpenClaw** — Restarts just the OpenClaw process. The machine stays up. Use this for quick recovery from a process-level issue or when you want to apply openclaw config changes.
- **Redeploy** — Stops and restarts the entire machine with the latest image and config. Use this when the changelog shows a redeploy hint, or after changing channel tokens or secrets.

### My instance restarted after I stopped it

A stopped KiloClaw instance cannot restart itself — the machine is fully off and no code runs. If your instance appeared to restart, check:

1. **Did someone else start it?** — If you share dashboard access, another user may have clicked **Start Machine**.
2. **Was it actually stopped?** — The dashboard status should show "Machine Stopped". If it showed "Machine Online", the stop may not have completed.
3. **Billing activity** — Check your usage to confirm the machine was actually off during the time you expected.

{% callout type="info" %}
Cron jobs and heartbeat checks only run when the machine is running. A stopped machine cannot wake itself via scheduled tasks. See [Understanding Stop Instance](/docs/automate/kiloclaw/dashboard#understanding-stop-instance) for details.
{% /callout %}

### My bot isn't responding on Telegram/Discord/Slack

1. Check that the channel token is configured in [Settings](/docs/automate/kiloclaw/dashboard#channels)
2. Make sure you **Redeployed** or **Restarted OpenClaw** after saving tokens
3. Check for pending [pairing requests](/docs/automate/kiloclaw/chat-platforms#pairing-requests) — the user may need to be approved
4. Try running **OpenClaw Doctor**

### The gateway shows "Crashed"

The OpenClaw process is automatically restarted when it crashes. Check the Gateway Process tab on your dashboard for the exit code and restart count. If it keeps crashing:

1. Run **OpenClaw Doctor**
2. Try a **Redeploy** to apply the latest platform image
3. If the issue persists, join the [Kilo Discord](https://kilo.ai/discord) and share details in the KiloClaw channel

### My access code isn't working

Access codes are one-time use and expire after 10 minutes. Generate a new one by clicking **Access Code** on the dashboard. Make sure your instance is running before clicking **Open**.

### I changed the model but the agent is still using the old one

After selecting a new model, click **Save & Provision** to apply it. This refreshes the API key and saves the new model. You may also need to **Restart OpenClaw** for the change to take full effect.

### How do I disable cron jobs without stopping the instance?

If you want to pause scheduled tasks but keep your instance running (for example, to continue receiving messages):

1. Open the [Control UI](/docs/automate/kiloclaw/control-ui)
2. Navigate to **Cron Jobs**
3. Toggle individual jobs to **Disabled**

Disabled jobs remain saved but won't execute until you re-enable them.

## Gateway Process States

The Gateway Process tab shows the current state of the OpenClaw process inside your machine:

- **Running** — The process is up and handling requests
- **Stopped** — The process is not running
- **Starting** — The process is booting up
- **Stopping** — The process is shutting down gracefully
- **Crashed** — The process exited unexpectedly and will be automatically restarted
- **Shutting Down** — The process is stopping as part of a machine stop or redeploy

## Architecture Notes

For advanced users — how KiloClaw instances are structured:

- **Dedicated machine** — Each user gets their own machine and persistent volume. There is no shared infrastructure between users.
- **Region-pinned storage** — Your persistent volume stays in the region where your instance was originally created.
- **Network isolation** — OpenClaw binds to loopback only; external traffic is proxied through a Kilo controller.
- **Per-user authentication** — The gateway token is derived per-user for authenticating requests to your machine.
- **Encryption at rest** — Sensitive data (API keys, channel tokens) is encrypted at rest in the machine configuration.

## Related

- [KiloClaw Overview](/docs/automate/kiloclaw/overview)
- [Dashboard Reference](/docs/automate/kiloclaw/dashboard)
- [Connecting Chat Platforms](/docs/automate/kiloclaw/chat-platforms)
- [KiloClaw Pricing](/docs/automate/kiloclaw/pricing)
