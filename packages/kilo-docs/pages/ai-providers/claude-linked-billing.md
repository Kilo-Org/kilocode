---
title: "Using Claude linked billing and sign-in with Kilo Code"
description: "Link a Claude API organization so Anthropic bills your Claude usage in Kilo directly, with no API key. Learn who can set it up and how personal and organization links differ."
sidebar_label: Claude linked billing and sign-in
---

# Using Claude linked billing and sign-in with Kilo Code

Kilo offers two separate Claude options:

- [**Linked billing**](/docs/ai-providers/claude-linked-billing#link-claude-billing) links your Claude API organization to Kilo. Anthropic bills it directly for Claude usage through the [Kilo Gateway](/docs/gateway), with no API key to share.
- [**Sign in with Claude**](/docs/ai-providers/claude-linked-billing#sign-in-with-claude) lets you log in to Kilo with your Claude account. It does not change who pays.

{% callout type="warning" title="API pricing, not a Claude subscription" %}
Linked billing works with **Claude API organizations** only, billed per token at API pricing. Claude Pro and Max subscriptions do not qualify.
{% /callout %}

## Link Claude billing

To approve the link, you need the **Owner**, **Admin**, or **Billing** role in your Claude organization's [Console](https://platform.claude.com).

1. Open the [BYOK page](https://app.kilo.ai/byok) in Kilo. To link an organization, switch to it first; only its owners and admins can link.
2. On the **Claude (linked billing)** card, choose **Link your Claude organization**.
3. Sign in to Claude, set a monthly spend limit if you want one, and approve.
4. Confirm that the card shows **Linked**.

Claude models are then marked **BYOK** in the model picker when you use the **Kilo Gateway** provider.

## Personal and organization links

| | Personal account | Organization |
|---|---|---|
| **Who can link or remove it** | You | Organization owners and admins |
| **What it pays for** | Your Claude requests outside any organization | Every member's Claude requests, and Kilo services such as Code Reviews |

A personal link is never used for organization requests, and an organization has one link for all members. Linking a personal account replaces any Anthropic API key saved on your personal BYOK page.

## Billing

- Anthropic bills your Claude organization. Kilo charges no credits for these requests.
- Set or change the spend limit under [Linked platforms in Claude Console](https://platform.claude.com/linked-platforms).
- If Anthropic declines billing, the request fails. Kilo does not fall back to Kilo credits.
- Requests still run in Kilo's Anthropic organization, so your own organization's settings, such as data retention and encryption keys, do not apply.

To stop using the link, choose **Remove from Kilo** on the card.

See Anthropic's announcement, [Linked billing on the Claude Platform](https://claude.com/resources/articles/linked-billing-on-claude-platform), for more.

## Sign in with Claude

On the Kilo sign-in page, choose **Continue with Claude**.

If a Kilo account already uses your Claude email address, Kilo asks you to confirm the account is yours, with an emailed code or an existing sign-in method, before it adds Claude. You can also add Claude from **Connected Accounts** in the user menu.

## Troubleshooting

**I signed in with Claude, but my usage still uses Kilo credits.**
Sign-in and linked billing are separate. Link a Claude organization on the BYOK page.

**I don't see a link button in my organization.**
Only organization owners and admins can link. Ask one of them to set it up.

**Linking did not complete.**
Check that you signed in to the right Claude account and that it has the Owner, Admin, or Billing role in the Claude organization.

**Requests fail with a billing error.**
Check the spend limit for Kilo and your credit balance in Claude Console.
