---
title: "Annual Billing"
description: "Annual billing architecture documentation"
---

# Annual Billing

# Overview

we want to switch to doing annual billing for teams and enterprise with a 1 month free and a "self-serve" sign up.

# Requirements

- no more 20$ of one time free credits on team signup per seat. **this is done**
- enable 30 day trial for both teams and enterprise
    - no credit card required
    - self-serve enterprise comes with no self-serve SSO. There's a button that puts them in touch with sales. (it costs us 125 a month for SSO per org)
- monthly plan is not accessible via the UI but is still in effect for existing customers and can be flagged back on easily.
- trial users can only upgrade to annual plans, 348/teams seat or $3588/ent seat, but we always talk about pricing in monthly terms.
- once trial expires, the organization will be denied access to the openrouter proxy endpoint, effectively disabling their kilocode usage w/ our API provider, and any existing outstanding credits they purchased will be locked up until they subscribe.

### Non-requirements

- fully self-service SSO enrollment for enterprise. There's still a bit of a touch required. Its possible to implement, but out of scope for this spec.
- pro-rated cancellation or refunds handled in a self-serve way.
- elastic seat counts with custom billing agreements for enterprise organizations.
- a full redesign of the team/enterprise sign up and pre-creation / marketing flow.

# System Design

System design is pretty straight-forward as we can _mostly_ leverage existing infrastructure and code.

- System remains the same other than adding a `billing_cycle` column to `organization_seats_purcahses` where we can track if it is `monthly` or `yearly`. The migration will set the default to `monthly` so we backfill all existing customers.
- We will use `created_at` on the organization as the start date for the free trial. If the organization does not have a valid entry in `organization_seats_purchases` after 30 days, we will disable their access to the openrouter proxy endpoint.

## Engineering Scope

#### Migrations:

- add `billing_cycle TEXT NOT NULL DEFAULT 'monthly'` to `organization_seats_purchases`.
- add `plan TEXT NOT NULL DEFAULT 'teams'` to `organizations` table which can be `teams` or `enterprise`. (While not strictly required we shouldn't rely on `seats_required` to decide if an org is a team or enterprise account and now is a good opportunity to fix this. Manually go through and set the very small number of design partner orgs and our org into `enterprise.` for now.)

#### Tasks:

- create yearly billing subscription product for teams AND for enterprise in stripe.
- change the organization create flow to create organization on submit (it does this now) but instead of redirecting to stripe to pay, redirect to organization page. Do not require an ahead-of-time seat count on either teams or enterprise.
- update logic for checking & displaying seats to take into consideration the free trial period, and allow invites for an unlimited number of seats while the trial is active.
- update subscription management page to allow for creating a new subscription from the page.
- update logic to actually block organizations which are not active on seats (they are either over their paid seat count or do not have an active seats purchases subscription). [a ticket for this already exists](https://github.com/orgs/Kilo-Org/projects/11?pane=issue&itemId=126001076&issue=Kilo-Org%7Ckilocode-backend%7C2167) note: this can wait until the end as by definition no one can have their trial expire for at least 30 days so we have a 30 day buffer to implement this.

### Marketing Scope

As a fast follow or in parallel the seats pod will pair up with someone from marketing or devrel to work on our engagement with this feature.

- update / redesign team/enterprise "create" page in app with better CTAs
- work with eng to get the 'buy credits' action more importantly called out when a new org is created. General org onboarding flow (both teams and enterprise) needs help.
- significantly improve call-to-action flows around upgrading to paid subscriptions with potentially progressively louder noise as we get closer to the end of trial notice.
- send welcome email when org is created explaining the trail period.
- probably cut new videos to show off the enterprise features

# Compliance Considerations

No compliance concerns.

# Features for the future

Talks about what we might want to build or improve upon in the future but is out-of-scope of this spec.
