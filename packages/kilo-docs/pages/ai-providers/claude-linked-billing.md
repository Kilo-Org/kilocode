---
title: "Using Claude linked billing and sign-in with Kilo Code"
description: "Link a Claude API organization so Anthropic bills your Claude usage in Kilo directly, with no API key, and sign in to Kilo with Claude. Learn who can set it up, how personal and organization links differ, and how billing works."
sidebar_label: Claude linked billing and sign-in
---

# Using Claude linked billing and sign-in with Kilo Code

Kilo offers two separate Claude options:

- [**Linked billing with Claude Platform**](/docs/ai-providers/claude-linked-billing#link-claude-billing) links your Claude API organization to Kilo. Anthropic then bills that organization directly for Claude usage through the [Kilo Gateway](/docs/gateway), instead of Kilo credits. No API key changes hands, so there is no key to store, rotate, or leak.
- [**Sign in with Claude**](/docs/ai-providers/claude-linked-billing#sign-in-to-kilo-with-claude) lets you use your Claude account as a login method for Kilo. It does not change who pays for model requests.

You can use either option without the other. Linked billing is a Claude Platform feature in beta; see Anthropic's announcement, [Linked billing on the Claude Platform](https://claude.com/resources/articles/linked-billing-on-claude-platform).

{% callout type="warning" title="Linked billing uses API pricing, not a Claude subscription" %}
Linked billing works with **Claude API organizations** only, the Claude Platform accounts you manage in [Claude Console](https://platform.claude.com). Anthropic bills usage per token at API pricing, on the terms that organization already has: it draws down an existing commitment or purchased credit balance, or is invoiced as you go.

Claude Pro and Max subscriptions and cloud marketplace billing do not qualify. Monthly API credits included with Max, Ultra, or Team plans, and credits from Anthropic partner, VC, or startup programs, cannot pay for linked usage.
{% /callout %}

## Link Claude billing

### Before you start

You need:

- A Claude API organization with a purchased credit balance or monthly invoicing.
- The **Owner**, **Admin**, or **Billing** role in that Claude organization's Console. Only those roles can approve the link.
- To link a Kilo organization, the **owner** or **admin** role in that Kilo organization. Members and billing managers can see the link's status but cannot change it.

### Choose where to link

Link in the place where you use Kilo:

- **You use Kilo in an organization:** Link on the organization's BYOK page. Select the organization in Kilo, then open **Bring Your Own Key (BYOK)** in the sidebar and find the **Claude billing** section. Your personal link is not used for organization requests.
- **You use Kilo with a personal account:** Link on your personal [BYOK page](https://app.kilo.ai/byok).

### Link a Claude organization

1. On the BYOK page, find the **Claude (linked billing)** card and choose **Link your Claude organization**.
2. Sign in to Claude. If you have more than one Claude organization, select the one to link.
3. Review how billing works, set a monthly spend limit for Kilo if you want one, and approve the link.
4. Return to Kilo and confirm that the card shows **Linked**.

After you link, Claude models are marked **BYOK** in the model picker of Kilo clients that use the **Kilo Gateway** provider. You may need to restart your client to refresh the model list.

{% callout type="note" title="Personal links remove your saved Anthropic key" %}
When you link your personal account, Kilo deletes any Anthropic API key saved on your personal BYOK page, because the link replaces it. Linking an organization keeps the organization's saved key.
{% /callout %}

## Personal and organization links

A link applies only where you create it. Kilo never uses a personal link for organization requests, or an organization link for personal requests.

| | Personal account | Organization |
|---|---|---|
| **Where to link** | Your personal [BYOK page](https://app.kilo.ai/byok) | The organization's BYOK page, under **Claude billing** |
| **Who can link or remove it in Kilo** | You | Organization owners and admins |
| **What it pays for** | Your own Claude requests outside any organization | Every member's Claude requests in the organization, and Kilo services that run for it, such as Code Reviews |
| **Number of links** | One | One for the whole organization |

Members do not link their own Claude organizations inside a Kilo organization.

### Use one Claude organization in more than one place

One Claude organization can pay for several Kilo accounts and organizations. After you link it once, open the BYOK page of another account or organization you manage and choose **Use your personal Claude link** or **Use Claude link from…** instead of linking again.

To switch to a different Claude organization, remove the current link first.

## Costs and spend limits

Anthropic bills linked usage to your Claude organization. Kilo records a cost of **$0** for these requests and does not deduct Kilo credits. Other Kilo costs, such as [Cloud Agent compute](/docs/code-with-ai/platforms/cloud-agent#cost), are not billed through the link.

Set a monthly spend limit for Kilo when you link, or later under [Linked platforms in Claude Console](https://platform.claude.com/linked-platforms). When usage reaches the limit, Claude requests stop until you raise the limit or the month resets on the 1st (UTC).

**If Anthropic declines billing, the request fails with an error.** Kilo does not fall back to Kilo credits or a saved API key.

## Data handling

Linking changes only who pays. Requests still run in Kilo's Anthropic organization, so settings in your own Claude organization, such as IP allowlists, encryption keys, a BAA, and data retention, do not apply to requests made through Kilo.

## Manage the link

Manage the link from the same BYOK page where you created it:

- **Set a spend limit or review usage:** Use the **Linked platforms** link on the card to open Claude Console.
- **Billing unavailable** or **New link required:** Claude requests fail until the link is fixed. Check Linked platforms in Claude Console, then link again from the card.
- **Remove from Kilo:** Ends the link for this account or organization. Later Claude requests use a saved BYOK key or Kilo credits.

## Sign in to Kilo with Claude

1. Open [Kilo](https://app.kilo.ai) and go to the sign-in options.
2. Choose **Continue with Claude**.
3. Sign in to Claude, review the permissions shown, and return to Kilo.

Kilo requests only your basic profile and email address for sign-in. It does not request access to billing. If no Kilo account uses your Claude email address, Kilo creates a new account.

### Add Claude to an existing Kilo account

If a Kilo account already uses the same email address as your Claude account, **Continue with Claude** does not sign you in right away. Kilo asks you to prove the account is yours first:

1. Choose **Continue with Claude** and sign in to Claude.
2. On the confirmation page, enter the code Kilo sends to your account email address, or sign in with a method the account already has.
3. Kilo adds Claude as a sign-in method for that account.

Finish within 15 minutes, or start again from sign-in.

You can also add Claude from inside Kilo. Sign in with your existing method, open **Connected Accounts** from the user menu, and choose **Link Claude Account**.

## Troubleshooting

**I signed in with Claude, but my usage still uses Kilo credits.**
Sign-in and linked billing are separate. Open the BYOK page for your organization or personal account and link a Claude organization.

**I have a Claude Pro or Max subscription. Can I use it?**
No. Linked billing requires a Claude API organization and is billed per token at API pricing. Subscription plans and their included credits cannot pay.

**I don't see a link button in my organization.**
Only organization owners and admins can link Claude billing. Ask an owner or admin to set it up.

**Linking did not complete.**
Check which Claude account you signed in with. Only a Console user with the Owner, Admin, or Billing role in the Claude organization can approve the link.

**Kilo says this Claude organization already has a link.**
Each Claude organization links to Kilo once. Use the existing link from the BYOK page if you control it, or ask the person who created it to share it. Otherwise, unlink Kilo under [Linked platforms in Claude Console](https://platform.claude.com/linked-platforms), then link again.

**My personal link does not work in an organization.**
Personal links cover only personal requests. Ask an organization owner or admin to link the organization.

**Requests fail with a spend limit or billing error.**
Check the spend limit for Kilo and your credit balance in Claude Console.

**Continue with Claude sent me to a confirmation page instead of signing me in.**
A Kilo account already uses your Claude email address. See [Add Claude to an existing Kilo account](/docs/ai-providers/claude-linked-billing#add-claude-to-an-existing-kilo-account).
