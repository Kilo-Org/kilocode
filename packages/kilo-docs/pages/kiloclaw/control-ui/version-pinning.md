---
title: "Version Pinning"
description: "Pin your KiloClaw instance to a specific OpenClaw version and variant"
---

# Version Pinning

Version pinning lets you lock your KiloClaw instance to a specific OpenClaw version and variant. This gives you control over when your instance upgrades — it stays on the pinned version until you explicitly change it.

## When to Use Version Pinning

Version pinning is useful when:

- A changelog entry is marked **Redeploy Required** and you're not ready to upgrade yet
- You're running a workflow that depends on specific OpenClaw behavior
- You want to test the impact of an upgrade before committing to it

## How to Pin a Version

1. Go to your [KiloClaw dashboard](https://app.kilo.ai/profile)
2. Open the **Settings** tab
3. Scroll to the **Version Pinning** section
4. Select a **version** and **variant** from the dropdowns
5. Click **Save**

Your instance will stay on the selected version until you change or clear the pin.

{% callout type="info" %}
After saving a version pin, you need to **Redeploy** for the change to take effect on your running instance.
{% /callout %}

## Variants

Each OpenClaw version is available in one or more variants. Variants may differ in included tools, default configuration, or base image. Select the variant that matches your use case, or use the default if unsure.

## Clearing a Pin

To return to automatic updates:

1. Go to **Settings > Version Pinning**
2. Clear the version selection
3. Click **Save**
4. Use **Upgrade & Redeploy** from the dashboard to apply the latest platform version

{% callout type="warning" %}
Clearing a pin and running **Upgrade & Redeploy** will update your instance to the latest supported platform version. Review the changelog before upgrading to check for breaking changes.
{% /callout %}
