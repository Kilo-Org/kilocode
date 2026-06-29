---
title: "Context & Mentions"
description: "How to provide context to Kilo Code using mentions"
---

# Context Mentions

Providing the right context helps Kilo Code understand your project and perform tasks accurately. All platforms support `@`-mentions for referencing files, and the agent can also discover context on its own using built-in tools like `read`, `grep`, and `glob`.

{% tabs %}
{% tab label="VSCode" %}

The extension supports `@`-mention autocomplete for file paths and also uses a tool-based context model where the agent can automatically discover and read files using built-in tools.

## How Context Works

When you describe a task, the agent uses its tools — `read`, `grep`, `glob`, and others — to find and read relevant files on its own. You don't need to explicitly point it at files in most cases; just describe what you want done and the agent will locate the right code.

### @-Mention Autocomplete

Type `@` in the chat input to get autocomplete suggestions. You can mention:

| Mention | Description | Example |
|---|---|---|
| **File** | Attach a file's contents to your message | `@src/utils.ts` |
| **Terminal** | Include your active VS Code terminal output | `@terminal` |
| **Git Changes** | Attach uncommitted working-tree diffs and new files | `@git-changes` |

Selecting a suggestion inserts the mention and highlights it in the input. File contents, terminal output, and git changes are attached as context when you send the message.

### Drag and Drop

You can also add file mentions by dragging and dropping:

| Source | How | Result |
|---|---|---|
| **Explorer / Editor tabs** | Drag a file or folder from VS Code's Explorer or an editor tab into the chat input | Inserts an `@/relative/path` mention |
| **Multiple files** | Drag several files at once | Inserts space-separated `@` mentions |
| **Agent Manager diff headers** | Drag a file header from the Agent Manager's diff panel into chat | Inserts an `@file` mention |
| **Images** | Hold **Shift** while dragging an image file from your OS file manager into the chat input | Attaches the image |

{% callout type="info" %}
VS Code requires holding **Shift** when dragging files from outside the editor (e.g. Finder or Windows Explorer) into a webview. This applies to image drops — file drops from within VS Code (Explorer, editor tabs) work without Shift.
{% /callout %}

### Automatic Editor Context

The extension automatically includes context from your editor with each message — your currently focused file and all open editor tabs. You don't need to mention these explicitly.

Selected code and editor diagnostics (errors/warnings) are not included automatically. However, you can send these to Kilo Code through VS Code's Code Actions: select code or hover over an error, then use the lightbulb menu to find context-dependent actions like "Explain with Kilo Code" or "Fix with Kilo Code."

### Tool-Based File Access

Rather than attaching file contents up front, the agent reads files on demand during its work:

| Tool | Purpose | Example |
|---|---|---|
| **read** | Read the contents of a specific file | Agent reads `src/utils.ts` to understand it |
| **glob** | Find files matching a pattern | Agent searches for `**/*.test.ts` |
| **grep** | Search file contents for a pattern | Agent searches for `function handleError` |
| **bash** | Run shell commands including `git` operations | Agent runs `git diff` or `git log` |

This means the agent can explore your entire project as needed, rather than being limited to files you explicitly mention.

## Best Practices

| Practice | Description |
|---|---|
| **Describe the task clearly** | The agent finds context on its own — focus on _what_ you want done rather than _where_ the code is |
| **Mention files when helpful** | If you know the exact file, mention its path to save the agent a search step |
| **Keep editor tabs relevant** | Open tabs are passed as context, so keep relevant files open |
| **Trust the agent's tools** | The agent can search, read, and explore your codebase — let it do the discovery work |

{% /tab %}
{% tab label="CLI" %}

The CLI uses a tool-based context model. The agent **automatically discovers and reads the context it needs** using built-in tools. In the TUI, you can type `@` to get file autocomplete suggestions for quick file references.

## How Context Works

When you describe a task, the agent uses its tools — `read`, `grep`, `glob`, and others — to find and read relevant files on its own. You don't need to explicitly point it at files in most cases; just describe what you want done and the agent will locate the right code.

### Providing File Context

In the terminal-based TUI, you can provide context in several ways:

- **Type `@` for file autocomplete** — In the TUI, type `@` followed by a filename to get autocomplete suggestions. Selecting a file attaches its contents to your message. You can limit how much is included by appending a line range, e.g. `@src/utils.ts#10-50`.
- **Mention file paths in your message** — Simply refer to files by path in your conversation text (e.g., "look at src/utils.ts") and the agent will read them.
- **Use `kilo run -f`** — When using the non-interactive `kilo run` command, pass `-f path/to/file.ts` to explicitly include a file's contents in the context.
- **Let the agent find files itself** — The agent has access to `glob` (find files by pattern), `grep` (search file contents), and `read` (read file contents) tools. Describe what you're looking for and it will locate the relevant code.

### Tool-Based File Access

Rather than attaching file contents up front, the agent reads files on demand during its work:

| Tool | Purpose | Example |
|---|---|---|
| **read** | Read the contents of a specific file | Agent reads `src/utils.ts` to understand it |
| **glob** | Find files matching a pattern | Agent searches for `**/*.test.ts` |
| **grep** | Search file contents for a pattern | Agent searches for `function handleError` |
| **bash** | Run shell commands including `git` operations | Agent runs `git diff` or `git log` |

This means the agent can explore your entire project as needed, rather than being limited to files you explicitly mention.

## Best Practices

| Practice | Description |
|---|---|
| **Describe the task clearly** | The agent finds context on its own — focus on _what_ you want done rather than _where_ the code is |
| **Mention files when helpful** | If you know the exact file, mention its path to save the agent a search step |
| **Use `kilo run -f`** | Pass key files with `-f` when using `kilo run` for immediate context |
| **Trust the agent's tools** | The agent can search, read, and explore your codebase — let it do the discovery work |

{% /tab %}
{% /tabs %}
