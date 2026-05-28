---
title: "Kilo Code for JetBrains: Free Open-Source AI Coding Plugin"
description: "Using Kilo Code in JetBrains IDEs"
---

# Kilo Code for JetBrains: Free AI Coding Plugin

## Installation

{% partial file="install-jetbrains.md" /%}

## Using the JetBrains plugin

After installation, open the **Kilo Code** tool window from the left tool window bar. The tool window toolbar includes **New Session**, **History**, **Profile**, and **Settings** actions so you can start work, reopen sessions, manage your account, and adjust plugin settings without leaving the IDE.

### Sign in and choose a profile

Use **Profile** in the Kilo Code tool window, or open **Settings/Preferences -> Tools -> Kilo Code -> User Profile**, to sign in and choose the active Kilo account. If a session needs credentials before it can continue, the chat panel shows an **Open User Profile** action.

### Start a session

Click **New Session**, type a prompt at the bottom of the tool window, and press **Enter** to send it. Kilo creates the session for the current project or worktree and streams responses in the tool window. While a session is running, use **Stop Session** to cancel the current request.

The prompt area includes the controls you use most often:

- **Mode selector**: choose how Kilo approaches the task, such as coding, planning, debugging, or asking questions.
- **Model selector**: choose the model for the current session and favorite models you use often.
- **Reasoning selector**: choose the reasoning effort when the selected model exposes reasoning variants.
- **Auto-approve toggle**: let Kilo continue through permission prompts automatically when that is appropriate for the task.

For the shared behavior behind modes and model choice, see [Using Agents](/docs/code-with-ai/agents/using-agents), [Model Selection](/docs/code-with-ai/agents/model-selection), and [Kilo Gateway Models & Providers](/docs/gateway/models-and-providers).

### Permissions and questions

When Kilo needs approval to read, edit, or run something, the request appears inline in the session. You can approve the prompt, reject the request, or answer follow-up questions before Kilo continues. Permission handling is shared with the Kilo runtime; see [Permissions](/docs/code-with-ai/platforms/cli#permissions) for the underlying actions and config behavior.

### History, cloud sessions, and compacting

Use **History** in the tool window toolbar to reopen local sessions for the current project. The history view also includes cloud-backed sessions; opening a cloud session imports it into local JetBrains session storage so you can continue it from the IDE. For the same shared session concepts in the CLI, see [Session Continuation](/docs/code-with-ai/platforms/cli#session-continuation).

Use **Compact session** in the session header when a conversation gets long and you want Kilo to summarize it before continuing with the selected model.

### Restart or reinstall the local runtime

The JetBrains plugin runs Kilo through a bundled local runtime. If the tool window cannot connect or the local runtime appears stuck, open the Kilo settings menu and use **Restart Kilo** to stop and restart the runtime process. If the bundled runtime binary appears missing or damaged, use **Reinstall Kilo** to re-extract it and restart.

For account, model availability, billing, and organization controls, use the shared [Kilo Gateway](/docs/gateway), [Authentication](/docs/gateway/authentication), and [Usage & Billing](/docs/gateway/usage-and-billing) docs.
