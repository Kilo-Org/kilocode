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
| Run a command | "Run the test suite and show me the failures." | [Terminal](/docs/desktop/features/terminal) |
| Review and manage changes | "Show me my uncommitted changes and create a branch for this work." | [Git integration](/docs/desktop/features/git) |
| Use a model on your machine | "Switch this chat to a local model." | [Local inference](/docs/desktop/features/local-inference) |
| Manage Python dependencies | "Create a conda environment with Python 3.12 and install pandas." | [Environments](/docs/desktop/features/environments) |
| Work with workspace files | "Read `src/api.py` and add input validation." | [Files](/docs/desktop/features/files) |
| Search Anaconda packages | "Find an Anaconda package for reading Parquet files." | [Anaconda MCP](https://anaconda.com/docs/anaconda-mcp/main) |

## Tips

- Reference workspace files directly with `@` in the chat to point the agent at a specific file.
- Type `/` in the chat to run slash commands for common actions like starting a new session or switching agents. See [slash commands](/docs/code-with-ai/platforms/cli#interactive-slash-commands).
- Keep each chat scoped to one workspace so the agent's tools operate on the right folder. Use the **Select workspace** control in the chat to choose the folder you want the agent to work in — its file, terminal, and git tools all run there.
