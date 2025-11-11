---
sidebar_label: À TRADUIRE: Usage Analytics & Reporting
---

# À TRADUIRE: Usage Analytics & Reporting

À TRADUIRE: Using Kilo seats with an Enterprise or Teams subscription provides detailed usage analytics to help you monitor and understand your organization's AI usage patterns, costs, and activity through the Kilo Gateway provider.

## À TRADUIRE: Analytics Dashboard Overview

À TRADUIRE: Access your organization's usage analytics through the **À TRADUIRE: Usage Details** section in your dashboard. The analytics show comprehensive data about your team's usage of the Kilo Gateway provider.

:::info À TRADUIRE: Usage Scope
À TRADUIRE: This usage overview includes all of your usage of the Kilo Gateway provider. It does **NOT** include any usage made via the Kilo Code extension to other, non-Kilo Code providers. You can choose which API provider to use from the extension's main settings page.
:::

## À TRADUIRE: Summary Metrics

À TRADUIRE: The dashboard displays five key metrics at the top:

- **À TRADUIRE: Total Spent** - À TRADUIRE: Total cost for the selected time period
- **À TRADUIRE: Total Requests** - À TRADUIRE: Number of API requests made
- **À TRADUIRE: Avg Cost per Request** - À TRADUIRE: Average cost per individual request
- **À TRADUIRE: Total Tokens** - À TRADUIRE: Total tokens processed (input + output)
- **À TRADUIRE: Active Users** - À TRADUIRE: Number of team members who made requests

## À TRADUIRE: Time Period Filters

À TRADUIRE: Select from four time period options to view usage data:

- **À TRADUIRE: Past Week** - À TRADUIRE: Last 7 days of usage
- **À TRADUIRE: Past Month** - À TRADUIRE: Last 30 days of usage
- **À TRADUIRE: Past Year** - À TRADUIRE: Last 365 days of usage
- **À TRADUIRE: All** - À TRADUIRE: Complete usage history

## À TRADUIRE: Usage View Options

### À TRADUIRE: Only My Usage Toggle

À TRADUIRE: Use the **À TRADUIRE: "Only my usage"** toggle to filter the data:

- **À TRADUIRE: Enabled** - À TRADUIRE: Shows only your personal usage data
- **À TRADUIRE: Disabled** - À TRADUIRE: Shows team-wide usage data for all members

### À TRADUIRE: Data Breakdown Views

À TRADUIRE: Choose between two data presentation formats:

### À TRADUIRE: By Day View

À TRADUIRE: Shows usage aggregated by date with columns:

- **À TRADUIRE: DATE** - À TRADUIRE: The specific date
- **À TRADUIRE: COST** - À TRADUIRE: Total spending for that date
- **À TRADUIRE: REQUESTS** - À TRADUIRE: Number of API requests made
- **À TRADUIRE: TOKENS** - À TRADUIRE: Total tokens processed (hover to show input vs. output tokens)
- **À TRADUIRE: USERS** - À TRADUIRE: Number of active users that date

À TRADUIRE: When viewing team data, you can click on any date row to expand and see individual user breakdowns for that day, showing each team member's usage, cost, requests, and tokens.

### À TRADUIRE: By Model & Day View

À TRADUIRE: Shows detailed usage broken down by AI model and date with columns:

- **À TRADUIRE: DATE** - À TRADUIRE: The specific date
- **À TRADUIRE: MODEL** - À TRADUIRE: The AI model used (e.g., anthropic/claude-sonnet-4, openai/gpt-4)
- **À TRADUIRE: COST** - À TRADUIRE: Cost for that model on that date
- **À TRADUIRE: REQUESTS** - À TRADUIRE: Number of requests to that model
- **À TRADUIRE: TOKENS** - À TRADUIRE: Tokens processed by that model (hover to show input vs. output tokens)
- **À TRADUIRE: USERS** - À TRADUIRE: Number of users who used that model

À TRADUIRE: Click on any row to expand and see which specific team members used that model on that date, along with their individual usage statistics.

### À TRADUIRE: By Project View

À TRADUIRE: You can also view usage **by project**.

À TRADUIRE: Project names are automatically parsed from the project's `.git/config` for the remote named `origin` (if there is one).

À TRADUIRE: For example, if the following were in your `.git/config`:

```bash
[remote "origin"]
    url = git@github.com:example-co/example-repo.git
    fetch = +refs/heads/*:refs/remotes/origin/*
```

À TRADUIRE: The project name would be `example-repo`.

À TRADUIRE: You can also manually override the project name in the `.kilocode/config.json` file in your project.

À TRADUIRE: To set the project identifier to `my-project`, create a `.kilocode/config.json` file with the following contents:

```json
{
	"project": {
		"id": "my-project"
	}
}
```

## À TRADUIRE: Understanding the Data

### À TRADUIRE: Model Information

À TRADUIRE: The analytics track usage across different AI models, showing the specific model identifiers such as:

- `anthropic/claude-sonnet-4`
- `openai/gpt-5`
- `x-ai/grok-code-fast-1`
- `mistralai/codestral-2508`

### À TRADUIRE: User Attribution

À TRADUIRE: When viewing team data, you can see:

- À TRADUIRE: Individual team member usage within expanded rows
- À TRADUIRE: Email addresses for user identification
- À TRADUIRE: Per-user cost, request, and token breakdowns

### À TRADUIRE: Cost Tracking

À TRADUIRE: All costs are displayed in USD with detailed precision, helping you:

- À TRADUIRE: Monitor spending patterns over time
- À TRADUIRE: Identify high-usage periods or models
- À TRADUIRE: Track individual team member contributions to costs

## À TRADUIRE: Next Steps

- [À TRADUIRE: Manage team billing settings](/plans/billing)
- [À TRADUIRE: Configure team roles and permissions](/plans/team-management)

À TRADUIRE: The usage analytics provide the insights needed to optimize your team's AI usage while maintaining visibility into costs and activity patterns.
