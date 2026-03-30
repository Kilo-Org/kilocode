---
title: "The Chat Interface"
description: "Learn how to use the Kilo Code chat interface effectively"
---

# Chatting with Kilo Code

{% callout type="tip" %}
**Bottom line:** Kilo Code is an AI coding assistant. You chat with it in plain English, and it writes, edits, and explains code for you.
{% /callout %}

{% callout type="note" title="Prefer quick completions?" %}
If you're typing code in the editor and want AI to finish your line or block, check out [Autocomplete](/docs/code-with-ai/features/autocomplete) instead. Chat is best for larger tasks, explanations, and multi-file changes.
{% /callout %}

## Quick Setup

{% tabs %}
{% tab label="VSCode" %}

Click the Kilo Code icon ({% kiloCodeIcon /%}) in VS Code's Primary Side Bar to open the sidebar chat. You can also pop it out into an editor tab for a larger workspace.

{% /tab %}
{% tab label="CLI" %}

Open your terminal and run `kilo` to launch the interactive terminal interface (TUI). You'll see a prompt where you can start typing requests immediately. The TUI is fully keyboard-driven — no mouse required.

{% /tab %}
{% tab label="VSCode (Legacy)" %}

Find the Kilo Code icon ({% kiloCodeIcon /%}) in VS Code's Primary Side Bar. Click it to open the chat panel.

**Lost the panel?** Go to View > Open View... and search for "Kilo Code"

{% /tab %}
{% /tabs %}

## How to Talk to Kilo Code

**The key insight:** Just type what you want in normal English. No special commands needed.

{% image src="/docs/img/typing-your-requests/typing-your-requests.png" alt="Example of typing a request in Kilo Code" width="800" caption="Example of typing a request in Kilo Code" /%}

**Good requests:**

- `create a new file named utils.py and add a function called add that takes two numbers as arguments and returns their sum`
- `in the file @src/components/Button.tsx, change the color of the button to blue`
- `find all instances of the variable oldValue in @/src/App.js and replace them with newValue`

**What makes requests work:**

- **Be specific** - "Fix the bug in `calculateTotal` that returns incorrect results" beats "Fix the code"
- **Use @ mentions** - Reference files and code directly with `@filename`
- **One task at a time** - Break complex work into manageable steps
- **Include examples** - Show the style or format you want

{% callout type="info" title="Chat vs Autocomplete" %}
**Use chat** when you need to describe what you want, ask questions, or make changes across multiple files.

**Use [autocomplete](/docs/code-with-ai/features/autocomplete)** when you're already typing code and want the AI to finish your thought inline.
{% /callout %}

## The Chat Interface

{% tabs %}
{% tab label="VSCode" %}

**Essential controls:**

- **Input prompt** - Type your requests and press Enter to send
- **Action buttons** - Approve or reject proposed changes, answer questions
- **Agent dropdown** - Switch between agents (e.g. Code, Ask, Plan) from the sidebar
- **Session management** - Start new sessions or resume previous ones

**Providing context:**

The extension automatically passes context from your editor, including your open tabs and active file. You can type `@` in the chat input to get file autocomplete suggestions, or mention file paths naturally in your message (e.g., "update src/utils.ts to add a helper function"). The agent can also discover files on its own using its built-in tools.

{% /tab %}
{% tab label="CLI" %}

**Essential controls:**

- **Input prompt** - Type your requests and press Enter to send
- **Action buttons** - Approve or reject proposed changes, answer questions
- **Agent cycling** - Switch between agents using keybinds or slash commands
- **Session management** - Start new sessions or resume previous ones
- **New task** - Start a new task, available using the `+` button at the top or `New Task` button above the chat input
- **Worktree** - Continue the current task with it's git state and session history in the Agent Manager in an isolated worktree
- **File changes** - Shows the number of lines changed and opens a diff view

**Providing context:**

Type `@` in the TUI to get file autocomplete suggestions, or mention file paths directly in your message (e.g., "look at src/utils.ts") and the agent will read them. When using the non-interactive `kilo run` command, you can pass `-f path/to/file.ts` to explicitly include files. The agent can also discover files on its own using its built-in tools.

{% /tab %}
{% tab label="VSCode (Legacy)" %}

{% image src="/docs/img/the-chat-interface/the-chat-interface-1.png" alt="Chat interface components labeled with callouts" width="800" caption="Everything you need is right here" /%}

**Essential controls:**

- **Chat history** - See your conversation and task history
- **Input field** - Type your requests here (press Enter to send)
- **Action buttons** - Approve or reject Kilo's proposed changes
- **Plus button** - Start a new task session
- **Mode selector** - Choose how Kilo should approach your task

**Providing context with @-mentions:**

Reference files and other context directly in your message using `@`:

- `@file` - Reference a specific file
- `@url` - Include content from a URL
- `@problems` - Include current VS Code problems
- `@terminal` - Include terminal output
- `@git-changes` - Include uncommitted changes
- `@commit` - Reference a specific commit

{% /tab %}
{% /tabs %}

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

| Instead of this...                | Try this                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| "Fix the code"                    | "Fix the bug in `calculateTotal` that returns incorrect results"                    |
| Assuming Kilo knows context       | Use `@` to reference specific files                                                 |
| Multiple unrelated tasks          | Submit one focused request at a time                                                |
| Technical jargon overload         | Clear, straightforward language works best                                          |
| Using chat for tiny code changes. | Use [autocomplete](/docs/code-with-ai/features/autocomplete) for inline completions |

**Why it matters:** Kilo Code works best when you communicate like you're talking to a smart teammate who needs clear direction.

## Suggested Responses

When Kilo Code needs more information to complete a task, it asks a follow-up question and often provides suggested answers to make responding faster.

**How it works:**

1. **Question Appears** - Kilo Code asks a question using the `question` tool
2. **Options Displayed** - Selectable options are presented that you can choose from
3. **Selection** - Pick an option or type a custom response

{% callout type="info" title="VSCode (Legacy)" collapsed=true %}
In the legacy extension, Kilo Code uses the `ask_followup_question` tool instead. Suggestions appear as clickable buttons below the question. You can click a button to send the answer directly, or hold `Shift` and click (or click the pencil icon {% codicon name="edit" /%}) to copy the suggestion into the input box for editing before sending.

{% image src="/docs/img/suggested-responses/suggested-responses.png" alt="Example of Kilo Code asking a question with suggested response buttons below it" width="800" caption="Suggested responses appear as clickable buttons below questions" /%}
{% /callout %}

**Benefits:**

- **Speed** - Quickly respond without typing full answers
- **Clarity** - Suggestions often clarify the type of information Kilo Code needs
- **Flexibility** - Edit suggestions to provide precise, customized answers when needed

This feature streamlines the interaction when Kilo Code requires clarification, allowing you to guide the task effectively with minimal effort.

## Tips for Better Workflow

{% tabs %}
{% tab label="VSCode" %}

{% callout type="tip" %}
**Switch agents for different tasks.** Use the agent dropdown, `/agents` slash command, or `Cmd+.` (`Ctrl+.` on Windows/Linux) to switch between agents like Code, Ask, and Plan. Each agent is tuned for a different type of task — see [Using Agents](/docs/code-with-ai/agents/using-agents) for details.
{% /callout %}

{% callout type="tip" %}
**Your editor context is automatic.** The extension reads your open tabs and active file, so you don't need to manually reference every file. Focus your message on what you want done.
{% /callout %}

{% callout type="tip" %}
**Pop out to an editor tab.** If the sidebar feels cramped, pop the chat into a full editor tab for more room.
{% /callout %}

{% /tab %}
{% tab label="CLI" %}

{% callout type="tip" %}
**Switch agents for different tasks.** Use `/agents`, press `Tab` to cycle agents, or use `Ctrl+X a` to open the agent picker. Each agent is tuned for a different type of task — see [Using Agents](/docs/code-with-ai/agents/using-agents) for details.
{% /callout %}

{% callout type="tip" %}
**The TUI is keyboard-driven.** Navigate, approve changes, and switch agents entirely from the keyboard — no mouse needed.
{% /callout %}

{% /tab %}
{% tab label="VSCode (Legacy)" %}

{% callout type="tip" %}
**Move Kilo Code to the Secondary Side Bar** for a better layout. Right-click on the Kilo Code icon in the Activity Bar and select **Move To → Secondary Side Bar**. This lets you see the Explorer, Search, Source Control, etc. alongside Kilo Code.

{% image src="/docs/img/move-to-secondary.png" alt="Move to Secondary Side Bar" width="600" caption="Move Kilo Code to the Secondary Side Bar for better workspace organization" /%}
{% /callout %}

{% callout type="tip" %}
**Drag files directly into chat.** Once you have Kilo Code in a separate sidebar from the file explorer, you can drag files from the explorer into the chat window (even multiple at once). Just hold down the Shift key after you start dragging the files.
{% /callout %}

{% /tab %}
{% /tabs %}

Ready to start coding? Start a session in Kilo Code and describe what you want to build!
