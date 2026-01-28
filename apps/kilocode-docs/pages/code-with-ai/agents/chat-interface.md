---
title: "The Chat Interface"
description: "Learn how to use the Kilo Code chat interface effectively"
---

# Chatting with Kilo Code

{% callout type="tip" %}
**Bottom line:** Kilo Code is an AI coding assistant that lives in VS Code. You chat with it in plain English, and it writes, edits, and explains code for you.
{% /callout %}

{% callout type="note" title="Prefer quick completions?" %}
If you're typing code in the editor and want AI to finish your line or block, check out [Autocomplete](/basic-usage/autocomplete) instead. Chat is best for larger tasks, explanations, and multi-file changes.
{% /callout %}

## Quick Setup

Find the Kilo Code icon ({% kilo-code-icon /%}) in VS Code's Primary Side Bar. Click it to open the chat panel.

**Lost the panel?** Go to View > Open View... and search for "Kilo Code"

## How to Talk to Kilo Code

**The key insight:** Just type what you want in normal English. No special commands needed.

{% image src="/docs/img/typing-your-requests/typing-your-requests.png" alt="Example of typing a request in Kilo Code" width="800" caption="Example of typing a request in Kilo Code" /%}

**Good requests:**

```
create a new file named utils.py and add a function called add that takes two numbers as arguments and returns their sum
```

```
in the file @src/components/Button.tsx, change the color of the button to blue
```

```
find all instances of the variable oldValue in @/src/App.js and replace them with newValue
```

**What makes requests work:**

- **Be specific** - "Fix the bug in `calculateTotal` that returns incorrect results" beats "Fix the code"
- **Use @ mentions** - Reference files and code directly with `@filename`
- **One task at a time** - Break complex work into manageable steps
- **Include examples** - Show the style or format you want

{% callout type="info" title="Chat vs Autocomplete" %}
**Use chat** when you need to describe what you want, ask questions, or make changes across multiple files.

**Use [autocomplete](/basic-usage/autocomplete)** when you're already typing code and want the AI to finish your thought inline.
{% /callout %}

## The Chat Interface

{% image src="/docs/img/the-chat-interface/the-chat-interface-1.png" alt="Chat interface components labeled with callouts" width="800" caption="Everything you need is right here" /%}

**Essential controls:**

- **Chat history** - See your conversation and task history
- **Input field** - Type your requests here (press Enter to send)
- **Action buttons** - Approve or reject Kilo's proposed changes
- **Plus button** - Start a new task session
- **Mode selector** - Choose how Kilo should approach your task

## Quick Interactions

**Click to act:**

- File paths → Opens the file
- URLs → Opens in browser
- Messages → Expand/collapse details
- Code blocks → Copy button appears

**Status signals:**

- Spinning → Kilo is working
- Red → Error occurred
- Green → Success

## Common Mistakes to Avoid

| Instead of this...                | Try this                                                             |
| --------------------------------- | -------------------------------------------------------------------- |
| "Fix the code"                    | "Fix the bug in `calculateTotal` that returns incorrect results"     |
| Assuming Kilo knows context       | Use `@` to reference specific files                                  |
| Multiple unrelated tasks          | Submit one focused request at a time                                 |
| Technical jargon overload         | Clear, straightforward language works best                           |
| Using chat for tiny code changes. | Use [autocomplete](/basic-usage/autocomplete) for inline completions |

**Why it matters:** Kilo Code works best when you communicate like you're talking to a smart teammate who needs clear direction.

Ready to start coding? Open the chat panel and describe what you want to build!
