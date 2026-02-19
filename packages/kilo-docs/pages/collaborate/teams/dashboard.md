---
title: "Dashboard"
description: "Manage your team from the Kilo Code dashboard"
---

# Dashboard

The Kilo seats dashboard is the first screen that comes up when you visit [the Kilo Code web app](https://app.kilo.ai). It provides complete visibility into your team's AI usage, costs, and management.

{% image src="/docs/img/teams/dashboard.png" alt="Invite your team members" width="700" /%}

## Dashboard Navigation

The dashboard is organized into tabs, each serving specific management needs:

- **Organization** - Team composition and quick actions
- **Usage** - Real-time analytics and cost tracking
- **Billing** - Financial management and invoicing
- **Subscriptions** - Plan management and seat allocation
- **Providers and models** (Enterprise Only) - Model availability and management
- **Single Sign-On (SSO)** (Enterprise Only) - Add or modify SSO settings

## Organization Tab

Your central hub for team management and organization overview.

### Key Information Display

- **Organization name** and creation date
- **Current seat usage** (e.g., "8 of 10 seats used")
- **Active members count** with role breakdown
- **Data collection policy** status

### Team Member List

View all team members with:

- Name and email address
- Current role (Owner, Admin, Member)
- Last activity timestamp

### Quick Actions

- **Buy Credits** - Direct link to credit purchase
- **Invite Member** - Send team invitations
- **Manage Seats** - Adjust subscription size
- **Policy Settings** - Configure data collection preferences

### Data Collection Controls

Toggle organization-wide policies:

- **Code training opt-out** - Prevent AI providers from using your code for training
- **Usage analytics** - Control internal usage tracking

## Usage Tab

Real-time visibility into your team's AI consumption and costs.

### Overview Metrics

- **Total spend** (current billing period)
- **Request count** (successful AI requests)
- **Average cost per request**
- **Token usage** (input/output breakdown)
- **Active users** (users with activity in last 7 days)

### Model Popularity

Visual breakdown showing:

- Most-used AI models by request count
- Cost distribution across different models
- Provider usage patterns
- Model performance metrics

### Time-Based Analytics

Interactive graphs displaying:

- **Daily usage trends** - Spot peak usage periods
- **Weekly patterns** - Understand team workflows
- **Monthly comparisons** - Track growth and optimization

### User-Level Insights

- Individual usage statistics (Owners and Admins only)
- Top users by request volume
- Usage distribution across team members

## Billing Tab

Complete financial management for your Kilo Teams subscription.

- **Available credits** remaining
- **Downloadable invoices** for expense reporting
- **Payment status** for each billing cycle
- **Primary payment method** on file
- **Payment history** with transaction details

### Purchase History

- **Credit purchases** with timestamps
- **Subscription changes** (seat additions/removals)
- **Refunds and adjustments** (if any)
- **Promotional credits** applied

## Subscriptions Tab

Manage your Kilo Teams plan and seat allocation.

### Current Plan Details

- **Plan type** (Kilo Teams)
- **Monthly cost** per seat ($15/user/month)
- **Billing cycle** dates and next charge
- **Plan benefits** and included features

### Seat Management

- **Current seat count** and utilization
- **Available seats** for new team members
- **Seat history** showing additions and removals
- **Cost impact** of seat changes with pro-rating

### Quick Actions

- **Add seats** for team growth
- **Remove unused seats** to optimize costs
- **Change billing frequency** (if available)
- **Cancel subscription** (with confirmation)

### Billing Cycle Information

- **Next billing date** and amount
- **Pro-rating calculations** for mid-cycle changes
- **Renewal settings** and automatic billing
- **Cancellation policy** and effective dates

## Providers and Models (Enterprise Only)

- Enable/disable models and providers
- Filter by model Data Policy:
    - Allows Training
    - Retains Prompts
    - Can Publish
- Extensive other filters:
    - Location
    - Input/Output Modalities
    - Context Length
    - Pricing

## Single Sign-On (SSO) (Enterprise Only)

- Set up SSO if not already configured

## Audit Logs (Enterprise Only)

- View timestamped user activities across the Organization
- View total events within dated periods
- Filter by action time, user, and date

## Next Steps

- [Learn about team management](/docs/plans/team-management)
- [Understand billing and credits](/docs/plans/billing)
- [Explore usage analytics](/docs/plans/analytics)
