---
title: "SSO"
description: "Configure Single Sign-On for your organization"
---

# SSO

Kilo Enterprise lets your organization securely manage access using **Single Sign-On (SSO)**. With SSO enabled, team members can sign in to Kilo using your company's existing identity provider, such as Okta, Github, Google Workspace, etc.

{% callout type="warning" %}
**IDP-initiated logins are not currently supported.** Users must navigate to the [Kilo Web App](https://app.kilo.ai) to log in. Logging in directly from your identity provider's dashboard is not supported at this time.
{% /callout %}

## Prerequisites

You’ll need:

- Admin or Owner permissions for your Kilo organization.
- Access to your **Identity Provider (IdP)** (e.g. Okta, Google Workspace, Azure AD).

## Initiating SSO Configuration

### 1. Open [Organization](https://app.kilo.ai/organizations) Dashboard

Find the Single Sign-On (SSO) Configuration panel, and click "Set up SSO":
{% image width="822" height="288" alt="Set-up-SSO screen" src="https://github.com/user-attachments/assets/b6ca5f83-4533-4d41-bcb1-0038b645c030" /%}

### 2. Submit the SSO Request Form

Fill in your contact information and someone from our team will reach out soon to help you configure SSO.

## Implementing SSO Configuration

Once the Kilo team has enabled SSO for your organization, your named admin will get an email from WorkOS to configure SSO.

{% callout type="warning" %}
**Save domain policy for last.**

If you configure domain policy before setting up SSO, you may lock users out of Kilo.
{% /callout %}

Your admin will need to use the WorkOS link to:

### 1. Configure your Identity Provider in WorkOS

Find the Metadata in your Identity Provider and apply that configuration in WorkOS.

### 2. Configure WorkOS in your Identity Provider

Copy the Service Provider details (Entity ID, ACS URL, and Metadata) from the WorkOS dashboard and apply them in your Identity Provider.

### 3. Configure Policy and Domain Settings in WorkOS

1. Set the organization policy and user provisioning settings according to your organization's needs.
2. Configure domain policy and domain verification in WorkOS.

[Verified-domain auto-join](/docs/collaborate/teams/team-management#joining-automatically-with-a-verified-domain) is separate from SSO domain policy. It adds users with a matching email domain to your organization and does not require SSO.

After enabling SSO:

- Invite new users with their company email domain.
- Manage team access and roles from the **[Organization](/docs/collaborate/adoption-dashboard/overview)** tab.
- View user activity across the team in the **[Audit Logs](/docs/collaborate/enterprise/audit-logs)** tab

## Directory Sync (SCIM)

Alongside SSO, Kilo Enterprise supports directory sync (SCIM) through WorkOS. When Directory Sync is enabled for your organization, Kilo applies WorkOS Directory Sync events so your identity provider drives provisioning instead of you inviting each person by hand. A directory group maps to a sub-organization, and a person's group memberships add or remove their access to match.

Creating, updating, reactivating, or deactivating a user in your IdP, and changing group membership, are applied automatically. As with SSO, the Kilo team configures Directory Sync in WorkOS for your organization. See [Sub-organizations](/docs/collaborate/enterprise/sub-organizations) for how provisioned sub-organizations are managed.

Before Kilo provisions or binds an account for a directory user, Kilo accepts the user's email domain when it matches your organization's SSO policy domain or is a domain your WorkOS organization reports as verified. Kilo requires DNS verification: a domain verified manually in the WorkOS dashboard is not accepted, because a manual tick does not prove your organization controls the domain, and binding can take over an account someone already holds. A directory user whose address uses any other domain is refused — Kilo neither creates an account nor takes over a pre-existing one. Because only one domain can be the SSO policy domain, the verified-domain check lets a single directory provision people across every mail domain your organization routes through it.

## Signing in with SSO

When you open an SSO sign-in link, Kilo checks whether your browser is already signed in to Kilo with a different address than the one the link requests. If the addresses differ, sign-in stops and Kilo shows a **Wrong account signed in** page instead of continuing. The page names the address the app requested and the address currently signed in, with a single button that signs out of the current browser session and returns you to SSO sign-in for the expected address. The switch keeps the original callback path and device code, so sign-in completes for the right account once you sign in with it. A matching address continues to the callback path unchanged.

Kilo trims spaces and ignores case when comparing addresses. A request without an `email` keeps the previous behavior, and an explicit `email` in the sign-in URL takes precedence over a remembered returning-user address when the form is prefilled.
