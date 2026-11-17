---
title: "Using Claude sign-in and linked billing with Kilo Code"
description: "Sign in to Kilo with Claude and link a Claude API organization so Anthropic bills your Claude usage directly. Learn who can set it up, how personal and organization links differ, and how billing works."
sidebar_label: Claude sign-in and linked billing
---

# Using Claude sign-in and linked billing with Kilo Code

Kilo offers two separate Claude options:

- **Sign in with Claude** lets you use your Claude account as a login method for Kilo. It does not change who pays for model requests.
- **Linked billing with Claude Platform** links a Claude API organization to a Kilo personal account or organization. Anthropic then bills that Claude organization directly for Claude usage through the [Kilo Gateway](/docs/gateway), instead of Kilo credits.

Linked billing is a Claude Platform feature that Anthropic offers in beta. See Anthropic's announcement, [Linked billing on the Claude Platform](https://claude.com/resources/articles/linked-billing-on-claude-platform), for how it works on their side.

You can use either option without the other. Signing in with Claude does not link billing, and linking billing does not add Claude as a login method.

{% callout type="warning" title="Linked billing uses API pricing, not a Claude subscription" %}
Linked billing works with **Claude API organizations** only, the Claude Platform accounts you manage in [Claude Console](https://platform.claude.com). Anthropic bills usage per token at API pricing, on the terms that organization already has: it draws down an existing commitment or purchased credit balance, or is invoiced as you go.

Claude Pro and Max subscriptions and cloud marketplace billing do not qualify. Monthly API credits included with Max, Ultra, or Team plans, and credits from Anthropic partner, VC, or startup programs, cannot pay for linked usage.
{% /callout %}

## Sign in to Kilo with Claude

1. Open [Kilo](https://app.kilo.ai) and go to the sign-in options.
2. Choose **Continue with Claude**.
3. Sign in to Claude, review the permissions shown, and return to Kilo.

Kilo requests only your basic profile and email address for sign-in. It does not request access to billing.

If no Kilo account uses your Claude email address, Kilo creates a new account.

### Add Claude to an existing Kilo account

If a Kilo account already uses the same email address as your Claude account, **Continue with Claude** does not sign you in right away. Kilo asks you to prove the account is yours first:

1. Choose **Continue with Claude** and sign in to Claude.
2. On the confirmation page, enter the code Kilo sends to your account email address, or sign in with a method the account already has.
3. Kilo adds Claude as a sign-in method for that account.

Finish within 15 minutes, or start again from sign-in. An emailed code is not offered for every account; if it is not, sign in with an existing method. From then on, **Continue with Claude** signs you in directly.

You can also add Claude from inside Kilo. Sign in with your existing method, open **Connected Accounts** from the user menu, and choose **Link Claude Account** under **Link New Account**. Linking this way attaches your Claude identity to the account you are signed in to, even if the two email addresses differ.

A Kilo account can have one Claude identity. If the account already has a different Claude account linked, sign-in with a second one is refused.

If your organization requires single sign-on, that requirement still applies when you sign in with Claude.

## Link Claude billing

Link billing on the Bring Your Own Key (BYOK) page of the personal account or organization that should pay.

### Before you start

You need:

- A Claude API organization in Claude Console with a purchased credit balance or monthly invoicing.
- The **Owner**, **Admin**, or **Billing** role in that Claude organization's Console. Only those roles can approve the link.
- For a Kilo organization, the **owner** or **admin** role in Kilo. See [who can set up linked billing](/docs/ai-providers/claude-linked-billing#who-can-set-up-linked-billing).

### Link a Claude organization

1. Sign in to Kilo and select the personal account or organization you want to link.
2. Open the [Bring Your Own Key (BYOK) page](https://app.kilo.ai/byok). In an organization, find the **Claude billing** section.
3. On the **Claude (linked billing)** card, choose **Link your Claude organization**.
4. Sign in to Claude and check which Claude account the approval page shows. It offers only the organizations of that account, and the organization you select pays. Switch accounts on that page if needed.
5. Review how billing works, set a monthly spend limit for Kilo if you want one, and approve the link.
6. Return to Kilo and confirm that the card shows **Linked**.

No Anthropic API key is needed.

{% callout type="note" title="Personal links remove your saved Anthropic key" %}
When you link your personal account, Kilo deletes any Anthropic API key saved on your personal BYOK page. Revoke that key in Claude Console if nothing else uses it. Removing the link later does not restore the key.

Linking an organization keeps the organization's saved Anthropic key.
{% /callout %}

## Personal and organization links

A link applies only to the Kilo account or organization where you create it. Kilo never uses a personal link for organization requests, or an organization link for personal requests.

| | Personal account | Organization |
|---|---|---|
| **Where to link** | Your personal [BYOK page](https://app.kilo.ai/byok) | The organization's BYOK page, under **Claude billing** |
| **Who can link or remove it in Kilo** | You | Organization owners and admins |
| **What it pays for** | Your own Claude requests outside any organization | Every member's Claude requests in the organization, and Kilo services that run for the organization, such as Code Reviews |
| **Number of links** | One | One for the whole organization |
| **Saved Anthropic BYOK key** | Deleted when you link | Kept |

An organization has a single link that pays for all of its Claude usage. Members do not link their own Claude organizations inside a Kilo organization.

### Who can set up linked billing

Two approvals are required, one on each side:

- **In Kilo:** For a personal account, you manage your own link. For an organization, only **owners** and **admins** can link, replace, or remove the link. Members and billing managers can see the link's status but cannot change it. They see a note asking them to contact an owner or admin.
- **In Claude Console:** Only a Console user with the **Owner**, **Admin**, or **Billing** role in the Claude organization can approve the link.

The link belongs to the Claude organization, not to the person who approved it. It stays active if that person later leaves the Claude organization.

If you are a Kilo organization owner but do not hold one of those roles in the Claude organization, ask someone who does to approve the link, or have a Kilo owner or admin who holds both roles complete the setup.

### Use one Claude organization in more than one place

One Claude organization can pay for several Kilo accounts and organizations. After you link it once, open the BYOK page of another account or organization you manage and choose **Use your personal Claude link** or **Use Claude link from…** instead of linking again. The card shows **Shared with** followed by the places that use the link.

You can share a link only if you manage both places. A link created for an organization can be shared only by the person who created it.

You can also link different Claude organizations to different Kilo accounts and organizations. Each Kilo account or organization has one link at a time. To switch to another Claude organization, remove the current link first.

## What linked billing covers

Linked billing applies to Anthropic Claude models requested through the Kilo Gateway. Other models are not affected and use your usual BYOK keys or Kilo credits.

- **Clients:** In the VS Code extension, CLI, or another Kilo client, sign in to the same Kilo account and use the **Kilo Gateway** provider. For Cloud Agents and Code Reviews, use the account or organization where you linked billing.
- **Priority:** For Claude models, a link takes priority over a saved Anthropic, AWS Bedrock, or Google Vertex BYOK key.
- **Organization controls:** [Model access controls](/docs/collaborate/enterprise/model-access-controls) still apply. A model or provider your organization blocks stays blocked.
- **API integrations:** The link supports the Messages and Chat Completions APIs. A Responses API request for a Claude model fails rather than using another payment method.

{% callout type="tip" title="Look for the BYOK badge" %}
After you link billing, covered Claude models are marked **BYOK** in the model picker. If the badge is missing, check that the card shows **Linked** on the BYOK page for the account or organization you are using. You may need to restart your Kilo client to refresh the model list.
{% /callout %}

Using a Claude model with an Anthropic API key configured directly in a Kilo client is a separate setup that does not use linked billing. See [Anthropic](/docs/ai-providers/anthropic).

## Costs and spend limits

Anthropic bills linked usage to your Claude organization. Kilo records a cost of **$0** for these requests and does not deduct Kilo credits or check your Kilo balance. Other Kilo costs are separate: [Cloud Agent compute](/docs/code-with-ai/platforms/cloud-agent#cost), Kilo Deploy, and other paid services are not billed through the link.

Set a monthly spend limit for Kilo when you link, or later under [Linked platforms in Claude Console](https://platform.claude.com/linked-platforms). When usage reaches the limit, Claude requests stop until you raise the limit or the month resets on the 1st (UTC). The limit counts usage at list price, before any discount. Console also shows how much the organization has spent through Kilo.

Anthropic usually emails your Claude organization's owners, admins, and billing members when Kilo is linked or unlinked, and emails admins when usage reaches 80% and 100% of a spend limit.

**If Anthropic declines billing, the request fails with an error.** Kilo does not fall back to Kilo credits or a saved API key. Buying Kilo credits does not get past a spend limit or an empty balance on the Claude side.

In an organization, the request logs show these requests as paid by the Claude organization.

## Data handling

Linking changes only who pays. Requests still run in Kilo's Anthropic organization under Kilo's data terms with Anthropic. Settings in your Claude organization, such as its BAA, IP allowlists, customer-managed encryption keys, and data retention, do not apply to requests made through Kilo.

## Manage the link

Return to the BYOK page in the account or organization where you linked:

- **Linked:** The link is active. Use the **Linked platforms** link on the card to set a spend limit or review the link in Claude Console.
- **Billing unavailable:** Anthropic stopped accepting charges for the link, for example because the link was ended in Claude Console or the Claude organization is no longer eligible. Claude requests fail until you fix it. Check Linked platforms in Claude Console, then choose **Link your Claude organization again** if needed.
- **New link required:** The Kilo account that created an organization's link no longer exists. Claude requests in the organization fail until an owner or admin chooses **Link Claude billing again**. A person leaving the organization does not cause this; the link stays in place.
- **Remove from Kilo:** Ends the link. If no other Kilo account or organization uses the same Claude organization, Kilo also ends the link at Anthropic, so it disappears from Linked platforms in Claude Console. Later Claude requests use a saved BYOK key or Kilo credits.

If you unlink Kilo only in Claude Console, the card in Kilo still shows the link until a request is refused, and then shows **Billing unavailable**. Remove the link in Kilo as well to return to BYOK keys or Kilo credits.

Deleting your Kilo account removes the links that only you use. A personal link you shared with an organization stays with that organization.

## Troubleshooting

**I signed in with Claude, but my usage still uses Kilo credits.**
Sign-in and linked billing are separate. Open BYOK in the correct personal account or organization and link a Claude organization.

**I have a Claude Pro or Max subscription. Can I use it?**
No. Linked billing requires a Claude API organization and is billed per token at API pricing. Subscription plans and their included credits cannot pay.

**I don't see a link button in my organization.**
Only organization owners and admins can link Claude billing. Ask an owner or admin to set it up.

**Continue with Claude sent me to a confirmation page instead of signing me in.**
A Kilo account already uses your Claude email address. Enter the emailed code or sign in with one of that account's existing methods to add Claude to it. See [Add Claude to an existing Kilo account](/docs/ai-providers/claude-linked-billing#add-claude-to-an-existing-kilo-account).

**Linking did not complete.**
The approval page offers only Claude organizations where the signed-in Claude account has an approving role. Check which Claude account you signed in with and your role in the organization you want to link.
A Console user with the Owner, Admin, or Billing role in the Claude organization must approve the link in Claude Console. If the Kilo account or organization already has a link, remove it before you link a different Claude organization.

**Kilo says this Claude organization already has a link.**
Each Claude organization links to Kilo once. Use the existing link from the BYOK page if you control it, or ask the person who created it to share it. If neither applies, unlink Kilo under [Linked platforms in Claude Console](https://platform.claude.com/linked-platforms), then link again.

**My personal link does not work in an organization.**
Personal links cover only personal requests. Switch to the organization and ask an owner or admin to link it or to share an existing link.

**Requests fail with a spend limit or billing error.**
Check the spend limit for Kilo, your Claude organization's monthly spend limit, and your credit balance in Claude Console. Requests work again once Anthropic can bill the organization.

**Kilo could not remove the link.**
If Anthropic does not confirm the unlink, Kilo keeps the link so billing stays consistent. Try again. If it still fails, unlink Kilo under Linked platforms in Claude Console, then remove the link in Kilo again.
