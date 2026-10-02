---
title: "Notebooks"
description: "Analyze data in interactive Python notebooks alongside your chat in Kilo Desktop."
---

# Notebooks

Open interactive Python notebooks in a panel next to your chat, so you can explore and visualize data without leaving the conversation. A notebook is a shared workspace you and the agent build together: you edit and run cells directly, while the agent reads, writes, and runs cells alongside you as you talk through the analysis. Notebooks run on a dedicated notebook runtime.

{% image src="/docs/img/desktop/notebooks-with-chat.png" alt="A Python notebook open beside a chat in Kilo Desktop" width="800" /%}

{% callout type="note" %}
Notebooks require a [Kilo account](/docs/desktop/settings/ai#ai-providers). Sign in to open and run notebooks.
{% /callout %}

## Open a notebook

A notebook opens as its own tab beside the chat. There are a few ways to get there:

- **Ask the agent** to list the files in your workspace, then select an `.ipynb` file in its reply to open it.
- **From the [Files](/docs/desktop/features/files) panel**, search or browse the workspace and select an `.ipynb` file.
- **Ask the agent to open it** by name — the agent can open and list notebooks for you, so the one you're discussing stays in view. You can also create a new notebook by asking the agent.

## Work with cells

The toolbar at the top of the notebook has controls to {% svgIcon src="/docs/img/desktop/code.svg" /%} add a code cell, {% svgIcon src="/docs/img/desktop/text-initial.svg" /%} add a Markdown cell, {% svgIcon src="/docs/img/desktop/chevrons-right.svg" /%} run cells, {% svgIcon src="/docs/img/desktop/rotate-ccw.svg" /%} restart the kernel, restart and run all cells, and {% svgIcon src="/docs/img/desktop/square.svg" /%} interrupt a running cell. Run a cell to see its output inline, and watch the kernel's status (such as **Idle**) on the right of the toolbar.

{% image src="/docs/img/desktop/notebooks-toolbar-controls.png" alt="The notebook toolbar" width="800" /%}

Each individual cell includes controls to {% svgIcon src="/docs/img/desktop/play.svg" /%} run it, switch it between {% svgIcon src="/docs/img/desktop/code.svg" /%} code and {% svgIcon src="/docs/img/desktop/text-initial.svg" /%} Markdown, {% svgIcon src="/docs/img/desktop/eye-off.svg" /%} hide its input or output, and {% svgIcon src="/docs/img/desktop/trash.svg" /%} delete it.

## Edit with the agent

Because the notebook stays in view beside the chat, you can work on it together with the agent. Ask it to make a change — fix a typo, add analysis, rework a chart — and it reads the notebook, edits or adds cells, and saves, with the results appearing in the open tab. A dot marks each cell the agent changes, so you can see at a glance what it edited.

## Environment and packages

Each notebook runs in a conda environment. Select the kernel button in the toolbar to see that environment — the `environment.yml` it uses, its kernel (`ipykernel`), and its channels. New notebooks can get a shared `environment.yml` in their workspace; toggle this under [Settings → Notebooks](/docs/desktop/settings/general#notebooks).

The agent can work with [conda environments](/docs/desktop/features/environments) too — ask it to find an appropriate conda environment for this notebook and point the notebook at it, and it will. A helpful pattern is to have the agent write an `environment.yml` into the workspace: then every notebook there, existing or new, picks up that environment automatically.

## Runtime status

The notebook runtime starts on demand. While it's starting you'll see a brief status; if it can't be reached, the panel shows a Retry button.