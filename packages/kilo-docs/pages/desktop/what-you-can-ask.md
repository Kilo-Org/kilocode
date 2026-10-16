---
title: "What you can ask"
description: "Example prompts for Kilo Desktop, mapped to the capability each one uses."
---

# What you can ask

Kilo Desktop's agent works across the tools in your workspace. Describe what you want in plain language, and the agent uses the matching capability. The table below maps common intents to example prompts and the [feature](/docs/desktop/features) they use.

| What you want | Example prompt | Capability |
|---|---|---|
| Analyze data interactively | "Load @sales.csv and plot monthly revenue in a notebook." | [Notebooks](/docs/desktop/features/notebooks) |
| Look something up on the web | "Open the pandas docs for `groupby` next to this chat." | [In-app browser](/docs/desktop/features/browser) |
| Review and manage changes | "Show me my uncommitted changes and create a branch for this work." | [Git integration](/docs/desktop/features/git) |
| Manage Python dependencies | "Create a conda environment with Python 3.12 and install pandas." | [Conda environments](/docs/desktop/features/environments) |
| Work with workspace files | "Read `src/api.py` and add input validation." | [Files](/docs/desktop/features/files) |

## Tips

- Reference workspace files directly with `@` in the chat to point the agent at a specific file.
- Keep each chat scoped to one workspace so the agent's tools operate on the right folders. Use the **Select workspace** control in the chat to choose the workspace you want the agent to work in — its file, terminal, and git tools all run inside the folders in that workspace.
