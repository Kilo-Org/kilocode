# Auto Cleanup

Auto Cleanup automatically manages your task history by removing old tasks to free up disk space and improve performance. Tasks are intelligently classified and retained based on their type and age, ensuring important work is preserved while temporary or experimental tasks are cleaned up.

{% callout type="warning" %}
Task deletion is permanent and cannot be undone. Deleted tasks are completely removed from disk, including all conversation history, checkpoints, and associated files.
{% /callout %}

## Overview

As you work with Kilo Code, each task creates files containing conversation history, checkpoints, and other data. Over time, this accumulates and can consume significant disk space. Auto-Cleanup solves this by:

- **Automatically removing old tasks** based on configurable retention periods
- **Preserving important tasks** by classifying them into different types
- **Protecting favorited tasks** from deletion
- **Managing disk usage** without manual intervention

{% callout type="info" title="Key Benefits" %}

- **Free up disk space**: Automatically remove old task data
- **Improve performance**: Reduce the size of task history
- **Flexible control**: Configure different retention periods for different task types
- **Safety first**: Favorited tasks can be protected from deletion
- **Manual override**: Run cleanup manually whenever needed
  {% /callout %}

## How Auto-Cleanup Works

Auto-Cleanup uses an intelligent classification system to determine how long each task should be retained:

### Task Classification

Every task is automatically classified into one of these categories:

| Task Type      | Description                               | Default Retention                        |
| -------------- | ----------------------------------------- | ---------------------------------------- |
| **Favorited**  | Tasks you've marked as favorites          | Never deleted (or 90 days if configured) |
| **Completed**  | Tasks that successfully finished          | 30 days                                  |
| **Incomplete** | Tasks that were started but not completed | 7 days                                   |
| **Regular**    | Default classification for other tasks    | 30 days                                  |

#### Understanding Task Completion

A task is considered "completed" when Kilo Code uses the [`attempt_completion`](/automate/tools/attempt-completion) tool to formally mark it as finished. Tasks without this completion marker are classified as incomplete, even if you consider them done. This distinction helps clean up abandoned or experimental tasks more aggressively.

### Cleanup Process

When Auto-Cleanup runs, it:

1. **Scans all tasks** in your task history
2. **Classifies each task** based on its properties and completion status
3. **Checks retention periods** to determine eligibility for deletion
4. **Protects active tasks** currently in use
5. **Deletes eligible tasks** and their associated files
6. **Reports results** including disk space freed

## Configuration

Access Auto-Cleanup settings through the Kilo Code settings panel:

1. Click the gear icon ({% codicon name="gear" /%}) in Kilo Code
2. Navigate to the **Auto-Cleanup** section (under Checkpoints)

### Enable Auto-Cleanup

{% image src="/docs/img/auto-cleanup/settings.png" alt="Auto-Cleanup settings panel" width="800" caption="Auto-Cleanup settings panel" /%}

Check the **"Enable automatic task cleanup"** option to activate the feature. When enabled, tasks will be automatically removed based on your retention settings.

### Retention Period Settings

Configure how long different types of tasks are kept before cleanup:

#### Default Retention Period

```
Default: 30 days
Minimum: 1 day
```

Sets the base retention period for regular tasks that don't fall into other categories.

#### Favorited Tasks

**Never delete favorited tasks** (recommended)

When enabled, favorited tasks are preserved indefinitely regardless of age. This is the safest option to prevent accidental deletion of important work.

If disabled, you can set a custom retention period:

```
Default: 90 days
Minimum: 1 day
```

To favorite a task, use the star icon in the task history panel.

#### Completed Tasks

```
Default: 30 days
Minimum: 1 day
```

Tasks successfully completed via the [`attempt_completion`](/automate/tools/attempt-completion) tool are retained for this period. These tasks typically represent finished work that may still be useful for reference.

#### Incomplete Tasks

```
Default: 7 days
Minimum: 1 day
```

Tasks without completion status are retained for a shorter period. This helps clean up experimental or abandoned tasks more quickly while still giving you time to review them.

### Last Cleanup Display

The settings show when the last cleanup operation ran, helping you understand the cleanup schedule.

### Manual Cleanup

Click the **"Run Cleanup Now"** button to immediately trigger a cleanup operation using your current settings. This is useful when:

- You need to free up disk space urgently
- You've changed retention settings and want them applied immediately
- You want to preview what would be cleaned up (check the output)

## Best Practices

### Recommended Retention Periods

**For Individual Developers:**

- Default retention: 30 days
- Completed tasks: 30 days
- Incomplete tasks: 7 days
- Favorited tasks: Never delete

**For Experimentation:**

- Default retention: 14 days
- Completed tasks: 14 days
- Incomplete tasks: 3 days
- Favorited tasks: Never delete

**For Limited Disk Space:**

- Default retention: 14 days
- Completed tasks: 14 days
- Incomplete tasks: 3 days
- Favorited tasks: 60 days

### Protecting Important Work

To ensure important tasks are never deleted:

1. **Mark tasks as favorites** using the star icon in task history
2. **Enable "Never delete favorited tasks"** in settings
3. **Review cleanup results** periodically to ensure retention periods are appropriate

### Balancing Disk Space and History

Consider these factors when setting retention periods:

- **Available disk space**: Shorter retention if space is limited
- **Task frequency**: More tasks = shorter retention needed
- **Reference needs**: Keep completed tasks longer if you often refer back
- **Experimentation**: Shorter incomplete task retention for heavy experimentation

## Troubleshooting

### Tasks Not Being Cleaned Up

**Issue**: Old tasks remain after cleanup runs

**Solutions**:

1. Verify Auto-Cleanup is enabled in settings
2. Check retention periods - they may be too long
3. Verify tasks are older than the retention period
4. Check if tasks are favorited (they won't be deleted if "Never delete" is enabled)

### Important Task Was Deleted

**Issue**: A task you needed was removed

**Prevention**:

1. Always favorite important tasks before they age out
2. Set longer retention periods for task types you reference frequently
3. Consider enabling "Never delete favorited tasks"
4. Export or backup critical task data before it ages out

{% callout type="warning" %}
Deleted tasks cannot be recovered. Always favorite important tasks or adjust retention periods to prevent accidental deletion.
{% /callout %}

### Cleanup Using Too Much Disk I/O

**Issue**: Cleanup operation impacts system performance

**Solutions**:

1. Check the "Operation duration" in cleanup results
2. If slow, consider reducing retention periods to clean fewer tasks at once
3. Run manual cleanup during non-working hours
4. Ensure adequate system resources during cleanup

### Active Task Protection

Auto-Cleanup automatically protects your currently active task from deletion, even if it meets the age criteria. This ensures you never lose work in progress during a cleanup operation.

## Technical Details

### What Gets Deleted

When a task is deleted, the following are permanently removed:

- Task directory and all contents
- Conversation history and messages
- Checkpoints (if enabled)
- API request logs
- Task metadata
- Associated temporary files

### Storage Location

Task data is stored in your VS Code global storage location:

- **macOS**: `~/Library/Application Support/Code/User/globalStorage/kilocode.kilo-code/`
- **Windows**: `%APPDATA%\Code\User\globalStorage\kilocode.kilo-code\`
- **Linux**: `~/.config/Code/User/globalStorage/kilocode.kilo-code/`

## Privacy & Data Handling

- **Local Operation**: All cleanup happens locally on your machine
- **No Cloud Backup**: Deleted tasks are not backed up automatically
- **Telemetry**: Anonymous usage statistics (tasks cleaned, disk space freed) are collected if telemetry is enabled
- **No Content Sharing**: Task content, code, or personal information is never transmitted

## Related Features

- [**Checkpoints**](/code-with-ai/features/checkpoints): Version control for tasks that can be restored
- [**Settings Management**](/getting-started/settings): Export/import settings including cleanup configuration
- [**Task History**](/code-with-ai/agents/chat-interface): Managing and organizing your task history

## Frequently Asked Questions

### Does Auto-Cleanup run automatically?

Yes, when enabled, Auto-Cleanup runs automatically based on the configured schedule. You can also trigger it manually using the "Run Cleanup Now" button.

### Can I recover deleted tasks?

No, task deletion is permanent. Always favorite important tasks or adjust retention periods to prevent accidental deletion.

### Does cleanup affect my current task?

No, the active task you're currently working on is automatically protected from deletion.

### What happens to checkpoints when a task is deleted?

All checkpoints associated with a deleted task are permanently removed along with the task data.

### Can I temporarily disable cleanup?

Yes, simply uncheck the "Enable automatic task cleanup" option in settings. Your configuration is preserved for when you enable it again.

### Why are some old tasks not being deleted?

Check if they are:

1. Favorited with "Never delete favorited tasks" enabled
2. Recently modified (even viewing a task may update its timestamp)
3. Protected by a longer retention period based on their type
