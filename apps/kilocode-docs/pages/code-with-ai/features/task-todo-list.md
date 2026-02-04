--- 
title: "Task Todo List"
description: "Track and manage tasks with AI-generated todo lists"
---

# Task Todo List

**The big picture**: Never lose track of complex development tasks again. Task Todo Lists create interactive, persistent checklists that live right in your chat interface.

**Why it matters**: Complex workflows have lots of moving parts. Without structure, it's easy to miss steps, duplicate work, or forget what comes next.

{% image src="/docs/img/task-todo-list/task-todo-list-1.png" alt="Task Todo List overview showing interactive checklist in Kilo Code" width="500" /%}

## How to trigger todo lists

**Automatic triggers**:

- Complex tasks with multiple steps
- Working in Architect mode
- Multi-phase workflows with dependencies

**Manual triggers**:

- Ask Kilo to "use the [update_todo_list tool](/docs/features/tools/update-todo-list)"
- Say "create a todo list"

**The bottom line**: Kilo decides what goes in the list, but you can provide feedback during approval dialogs.

---

## How todo lists are updated

Todo lists are managed with the [`update_todo_list` tool](/docs/features/tools/update-todo-list). Each time Kilo updates the list, it replaces the entire checklist with the latest view of the task.

Kilo updates the list when:

- New steps are discovered
- Items are completed or reprioritized
- You explicitly ask for a todo list

---

## The old way vs. the new way

**Before**: You juggled task steps in your head or scattered notes, constantly wondering "what's next?"

**Now**: Kilo creates structured checklists that update automatically as work progresses. You see exactly where you are and what's coming up.

---

## Where todo lists appear

**1. Task Header Summary**
Quick progress overview with your next important item

{% image src="/docs/img/task-todo-list/task-header.png" alt="Task header summary showing todo list progress" width="500" /%}

Click the task header summary to expand the full list inline and jump to the current item.

**2. Interactive Tool Block**
Full todo interface in chat where you can:

- See all items and their status
- Edit descriptions when Kilo asks for approval
- Stage changes using the "Edit" button

**3. Environment Details**
Background "REMINDERS" table that keeps Kilo informed about current progress

## Task status decoded

**Pending** -> Empty checkbox (not started)

{% image src="/docs/img/task-todo-list/not-started.png" alt="Pending todo item with empty checkbox" width="300" /%}

---

**In Progress** -> Yellow dot (currently working)

{% image src="/docs/img/task-todo-list/in-progress.png" alt="In progress todo item with yellow dot indicator" width="300" /%}

---

**Completed** -> Green checkmark (finished)

{% image src="/docs/img/task-todo-list/complete.png" alt="Completed todo item with green checkmark" width="300" /%}

---

## Editing todo lists

When Kilo proposes a todo list update, you can edit the list before approving. Use the "Edit" button in the tool block to update item text, add or remove steps, or adjust status. Once approved, Kilo continues with the updated list.

## Common questions

**"Can I create my own todo lists?"**
Yes, just ask Kilo to use the update_todo_list tool. But Kilo stays in control of the content and workflow.

**"What about simple tasks?"**
Kilo typically skips todo lists for simple tasks. The overhead isn't worth it.

**"Why can't I directly edit the list?"**
Design choice. Kilo maintains authority over task management to ensure consistent progress tracking. You provide input, Kilo executes.

---

## Settings

You can disable todo lists in Settings -> Advanced -> **Enable todo list tool**. When disabled, Kilo won't create or update todo lists, and the REMINDERS table won't appear in Environment Details.

{% callout type="tip" title="Pro tip: Auto-approval" %}
**What it does**: Automatically approves todo list updates without confirmation prompts.

**When to use it**: Long workflows where constant interruptions slow you down.

**How to enable it**: Check the [Update Todo List auto-approval settings](/docs/features/auto-approving-actions#update-todo-list).

**The catch**: Less control, but faster execution.
{% /callout %}

