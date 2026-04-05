---
title: "Scheduled Triggers"
description: "Run tasks on a schedule using cron expressions"
---

# Scheduled Triggers

Scheduled triggers let your KiloClaw agent run tasks automatically on a recurring schedule. Instead of waiting for an external event, a scheduled trigger fires at the times you define using cron expressions. When it fires, the prompt template is rendered and delivered as a chat message to your KiloClaw instance, just like a webhook.

## Setup

1. Go to **Settings** under the KiloClaw section in the sidebar
2. Find the **Scheduled Triggers** section and click **Add Scheduled Trigger**
3. Give your trigger a name (minimum 8 characters)
4. Configure the schedule and prompt template
5. Click **Save**

Each KiloClaw instance supports up to **5 scheduled triggers** alongside its single webhook.

## Configuring a Schedule

The schedule builder defaults to a friendly picker view. For more control, click **<> Advanced** to switch to raw cron input.

### Simple Mode (default)

Pick a frequency, time, and (optionally) days of the week from dropdown menus. The builder generates the cron expression for you behind the scenes and shows a preview of the next 5 upcoming runs.

- **Repeat**: Every 10 minutes, every 15 minutes, every 30 minutes, hourly, daily, weekly
- **At**: Select the time of day (for daily and weekly frequencies)
- **Day of week**: Select which days the trigger should fire (for weekly frequency)

### Advanced Mode

Click **<> Advanced** to enter a raw cron expression directly. This gives you full control over the schedule. The expression is validated in real time with a preview of upcoming fire times.

Cron expressions use the standard five-field format:

```
┌───────── minute (0-59)
│ ┌───────── hour (0-23)
│ │ ┌───────── day of month (1-31)
│ │ │ ┌───────── month (1-12)
│ │ │ │ ┌───────── day of week (0-7, where 0 and 7 are Sunday)
│ │ │ │ │
* * * * *
```

**Examples:**

| Expression | Meaning |
| --- | --- |
| `*/15 * * * *` | Every 15 minutes |
| `0 9 * * 1-5` | 9:00 AM on weekdays |
| `0 0 1 * *` | Midnight on the first of each month |
| `30 14 * * 3` | 2:30 PM every Wednesday |

{% callout type="note" title="Minimum interval" %}
The minimum interval between scheduled trigger runs is 10 minutes. Schedules more frequent than that are rejected.
{% /callout %}

### Timezone

Select a timezone for your schedule. The default is UTC. All fire times are calculated relative to the selected timezone, including automatic handling of daylight saving time transitions.

## Prompt Template

The prompt template controls what message your agent receives when the schedule fires. You can customize it from the trigger's settings.

**Default template:**

```
Run your scheduled task. Triggered at {{scheduledTime}}.
```

**Available variables:**

| Variable | Description |
| --- | --- |
| `{{scheduledTime}}` | The time the schedule fired (ISO string) |
| `{{timestamp}}` | Capture timestamp (ISO string) |

{% callout type="note" title="Webhook variables are not available" %}
Since scheduled triggers do not receive an HTTP request, variables like `{{body}}`, `{{bodyJson}}`, `{{headers}}`, `{{method}}`, `{{path}}`, and `{{query}}` are not populated. Use `{{scheduledTime}}` and `{{timestamp}}` instead.
{% /callout %}

## Managing Scheduled Triggers

### Pause and Resume

Toggle the **Active/Paused** switch to temporarily stop a trigger from firing. When paused, the schedule is suspended but the configuration is preserved. Resume at any time to restart the schedule.

### Edit

You can update the cron expression, timezone, and prompt template of an existing scheduled trigger at any time. The activation mode (webhook vs. scheduled) cannot be changed after creation.

### Delete

Remove a scheduled trigger from the inline controls in the Settings panel. A confirmation dialog is shown before deletion.

## Viewing Scheduled Trigger Activity

Scheduled trigger invocations appear in the same request history as webhooks. The **Source** column shows a **Scheduled** badge to distinguish them from webhook-triggered requests. Click into a request to see the scheduled fire time and other details.

## Example: Daily Standup Summary

Create a scheduled trigger that fires every weekday morning and asks your agent to summarize overnight activity:

1. Add a scheduled trigger in your KiloClaw Settings
2. Set the frequency to **Weekly** on **Monday through Friday** at **9:00 AM** in your local timezone
3. Customize the prompt template:

```
Good morning! Please summarize any overnight activity in the #engineering Slack channel and list open pull requests that need review today. Triggered at {{scheduledTime}}.
```

Your agent will receive this message every weekday at 9:00 AM and respond with the summary.

## Related

- [Webhooks](/docs/kiloclaw/triggers/webhooks)
- [Triggers Overview](/docs/kiloclaw/triggers)
- [KiloClaw Overview](/docs/kiloclaw/overview)
- [Dashboard Reference](/docs/kiloclaw/dashboard)
