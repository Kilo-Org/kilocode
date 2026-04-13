---
title: "FAQ"
description: "Frequently asked questions about KiloClaw"
---

# FAQ

## How can I change my model?

You can change the model in two ways:

- **From chat** — Type `/model` in the Chat window within the OpenClaw Control UI to switch models directly.
- **From the dashboard** — Go to [https://app.kilo.ai/claw](https://app.kilo.ai/claw), select the model you want, and click **Save**. No redeploy is needed.

## Can I access the filesystem?

You can access instance files in `/root/.openclaw/` directly from the [KiloClaw Dashboard](https://app.kilo.ai/claw). This is useful for examining or restoring config files. You can also interact with files through your OpenClaw agent using its built-in file tools.

## Can I access my KiloClaw via SSH?

For security reasons, SSH access is currently disabled for all KiloClaw instances. Our primary goal is to provide a secure environment for all users, and restricting direct SSH access is one of the many measures we take to ensure the platform remains safe and protected for everyone.

## How can I update my OpenClaw?

Do **not** click **Update Now** inside the OpenClaw Control UI — this is not supported for KiloClaw instances and may break your setup.

Updates are managed by the KiloClaw platform team to ensure stability. When a new version is available, it will be announced in the **Changelog** on your dashboard. To apply the update, click **Upgrade & Redeploy** from the [KiloClaw Dashboard](/docs/kiloclaw/dashboard#redeploy).

## How do I migrate my OpenClaw?

Whether you're migrating from another OpenClaw provider to KiloClaw, moving between KiloClaw instances (e.g., individual to org or vice versa), or leaving KiloClaw for another OpenClaw provider, you should plan to migrate your workspace, memory, and context so your new Claw retains the same knowledge as before.

You should plan to reconfigure integrations in the new instance as these are often tied to the instance and will break if you attempt migration.

### 1. Back up your workspace

Have your current instance export the workspace. We recommend creating a GitHub repo or `tar` archive file for easy loading.

If you are on KiloClaw, you can use

**GitHub export** — make sure [GitHub is configured](/docs/kiloclaw/development-tools/github) and ask your instance:

> Create a new GitHub repo and push your entire workspace there with the `gh` CLI. Tell me the URL of the repo you used.

**Google Drive** — make sure [Google Drive is configured](/docs/kiloclaw/development-tools/google) and ask your instance:

> Tar compress your workspace and push the file to Google Drive with the `gog` CLI. Then share the filename you used.

### 2. Stand up the new instance

### 3. Reconfigure integrations on the new instance

If you are using GitHub or Google Drive for the migration, prioritize that configuration.

### 4. Restore the workspace on the new instance

On your new Claw, restore the workspace from whichever backup method you used:

**From GitHub:**

> The GitHub repo `<repo>` has a backup of your workspace. Pull the workspace from the repo with the `gh` CLI and overwrite the existing workspace directory with the repo's contents.

**From Google Drive:**

> The Google Drive file `<filename>` has a backup of your workspace. Pull the tar file from Google Drive with the `gog` CLI and overwrite the existing workspace directory with its contents.

{% callout type="note" %}
Replace `<repo>` or `<filename>` with the actual repository URL or filename from the backup step.
{% /callout %}
