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

| Mention          | Description                                           | Example         |
| ---------------- | ----------------------------------------------------- | --------------- |
| **File**         | Attach a file's contents to your message              | `@src/utils.ts` |
| **Terminal**     | Include your active VS Code terminal output           | `@terminal`     |
| **Git Changes**  | Attach uncommitted working-tree diffs and new files   | `@git-changes`  |

Selecting a suggestion inserts the mention and highlights it in the input. File contents, terminal output, and git changes are attached as context when you send the message.

### Drag and Drop

You can also add file mentions by dragging and dropping:

| Source                         | How                                                                                       | Result                               |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------ |
| **Explorer / Editor tabs**     | Drag a file or folder from VS Code's Explorer or an editor tab into the chat input        | Inserts an `@/relative/path` mention |
| **Multiple files**             | Drag several files at once                                                                | Inserts space-separated `@` mentions |
| **Agent Manager diff headers** | Drag a file header from the Agent Manager's diff panel into chat                          | Inserts an `@file` mention           |
| **Images**                     | Hold **Shift** while dragging an image file from your OS file manager into the chat input | Attaches the image                   |

{% callout type="info" %}
VS Code requires holding **Shift** when dragging files from outside the editor (e.g. Finder or Windows Explorer) into a webview. This applies to image drops — file drops from within VS Code (Explorer, editor tabs) work without Shift.
{% /callout %}

### Automatic Editor Context

The extension automatically includes context from your editor with each message — your currently focused file and all open editor tabs. You don't need to mention these explicitly.

Selected code and editor diagnostics (errors/warnings) are not included automatically. However, you can send these to Kilo Code through VS Code's Code Actions: select code or hover over an error, then use the lightbulb menu to find context-dependent actions like "Explain with Kilo Code" or "Fix with Kilo Code."

### Tool-Based File Access

Rather than attaching file contents up front, the agent reads files on demand during its work:

| Tool     | Purpose                                       | Example                                     |
| -------- | --------------------------------------------- | ------------------------------------------- |
| **read** | Read the contents of a specific file          | Agent reads `src/utils.ts` to understand it |
| **glob** | Find files matching a pattern                 | Agent searches for `**/*.test.ts`           |
| **grep** | Search file contents for a pattern            | Agent searches for `function handleError`   |
| **bash** | Run shell commands including `git` operations | Agent runs `git diff` or `git log`          |

This means the agent can explore your entire project as needed, rather than being limited to files you explicitly mention.

## Best Practices

| Practice                       | Description                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| **Describe the task clearly**  | The agent finds context on its own — focus on _what_ you want done rather than _where_ the code is |
| **Mention files when helpful** | If you know the exact file, mention its path to save the agent a search step                       |
| **Keep editor tabs relevant**  | Open tabs are passed as context, so keep relevant files open                                       |
| **Trust the agent's tools**    | The agent can search, read, and explore your codebase — let it do the discovery work               |

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

| Tool     | Purpose                                       | Example                                     |
| -------- | --------------------------------------------- | ------------------------------------------- |
| **read** | Read the contents of a specific file          | Agent reads `src/utils.ts` to understand it |
| **glob** | Find files matching a pattern                 | Agent searches for `**/*.test.ts`           |
| **grep** | Search file contents for a pattern            | Agent searches for `function handleError`   |
| **bash** | Run shell commands including `git` operations | Agent runs `git diff` or `git log`          |

This means the agent can explore your entire project as needed, rather than being limited to files you explicitly mention.

## Best Practices

| Practice                       | Description                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| **Describe the task clearly**  | The agent finds context on its own — focus on _what_ you want done rather than _where_ the code is |
| **Mention files when helpful** | If you know the exact file, mention its path to save the agent a search step                       |
| **Use `kilo run -f`**          | Pass key files with `-f` when using `kilo run` for immediate context                               |
| **Trust the agent's tools**    | The agent can search, read, and explore your codebase — let it do the discovery work               |

{% /tab %}
{% tab label="VSCode (Legacy)" %}

Context mentions are a powerful way to provide Kilo Code with specific information about your project, allowing it to perform tasks more accurately and efficiently. You can use mentions to refer to files, folders, problems, and Git commits. Context mentions start with the `@` symbol.

{% image src="/docs/img/context-mentions/context-mentions.png" alt="Context Mentions Overview - showing the @ symbol dropdown menu in the chat interface" width="600" caption="Context mentions overview showing the @ symbol dropdown menu in the chat interface." /%}

## Types of Mentions

{% image src="/docs/img/context-mentions/context-mentions-1.png" alt="File mention example showing a file being referenced with @ and its contents appearing in the conversation" width="600" caption="File mentions add actual code content into the conversation for direct reference and analysis." /%}

| Mention Type    | Format                 | Description                                 | Example Usage                            |
| --------------- | ---------------------- | ------------------------------------------- | ---------------------------------------- |
| **File**        | `@/path/to/file.ts`    | Includes file contents in request context   | "Explain the function in @/src/utils.ts" |
| **Folder**      | `@/path/to/folder/`    | Provides directory structure in tree format | "What files are in @/src/components/?"   |
| **Problems**    | `@problems`            | Includes VS Code Problems panel diagnostics | "@problems Fix all errors in my code"    |
| **Terminal**    | `@terminal`            | Includes recent terminal command and output | "Fix the errors shown in @terminal"      |
| **Git Commit**  | `@a1b2c3d`             | References specific commit by hash          | "What changed in commit @a1b2c3d?"       |
| **Git Changes** | `@git-changes`         | Shows uncommitted changes                   | "Suggest a message for @git-changes"     |
| **URL**         | `@https://example.com` | Imports website content                     | "Summarize @https://docusaurus.io/"      |

### File Mentions

{% image src="/docs/img/context-mentions/context-mentions-1.png" alt="File mention example showing a file being referenced with @ and its contents appearing in the conversation" width="600" caption="File mentions incorporate source code with line numbers for precise references." /%}

| Capability      | Details                                                         |
| --------------- | --------------------------------------------------------------- |
| **Format**      | `@/path/to/file.ts` (always start with `/` from workspace root) |
| **Provides**    | Complete file contents with line numbers                        |
| **Supports**    | Text files, PDFs, and DOCX files (with text extraction)         |
| **Works in**    | Initial requests, feedback responses, and follow-up messages    |
| **Limitations** | Very large files may be truncated; binary files not supported   |

### Folder Mentions

{% image src="/docs/img/context-mentions/context-mentions-2.png" alt="Folder mention example showing directory contents being referenced in the chat" width="600" caption="Folder mentions display directory structure in a readable tree format." /%}

| Capability   | Details                                                |
| ------------ | ------------------------------------------------------ |
| **Format**   | `@/path/to/folder/` (note trailing slash)              |
| **Provides** | Hierarchical tree display with ├── and └── prefixes    |
| **Includes** | Immediate child files and directories (not recursive)  |
| **Best for** | Understanding project structure                        |
| **Tip**      | Use with file mentions to check specific file contents |

### Problems Mention

{% image src="/docs/img/context-mentions/context-mentions-3.png" alt="Problems mention example showing VS Code problems panel being referenced with @problems" width="600" caption="Problems mentions import diagnostics directly from VS Code's problems panel." /%}

| Capability   | Details                                               |
| ------------ | ----------------------------------------------------- |
| **Format**   | `@problems`                                           |
| **Provides** | All errors and warnings from VS Code's problems panel |
| **Includes** | File paths, line numbers, and diagnostic messages     |
| **Groups**   | Problems organized by file for better clarity         |
| **Best for** | Fixing errors without manual copying                  |

### Terminal Mention

{% image src="/docs/img/context-mentions/context-mentions-4.png" alt="Terminal mention example showing terminal output being included in Kilo Code's context" width="600" caption="Terminal mentions capture recent command output for debugging and analysis." /%}

| Capability     | Details                                            |
| -------------- | -------------------------------------------------- |
| **Format**     | `@terminal`                                        |
| **Captures**   | Last command and its complete output               |
| **Preserves**  | Terminal state (doesn't clear the terminal)        |
| **Limitation** | Limited to visible terminal buffer content         |
| **Best for**   | Debugging build errors or analyzing command output |

### Git Mentions

{% image src="/docs/img/context-mentions/context-mentions-5.png" alt="Git commit mention example showing commit details being analyzed by Kilo Code" width="600" caption="Git mentions provide commit details and diffs for context-aware version analysis." /%}

| Type                | Format         | Provides                                            | Limitations                    |
| ------------------- | -------------- | --------------------------------------------------- | ------------------------------ |
| **Commit**          | `@a1b2c3d`     | Commit message, author, date, and complete diff     | Only works in Git repositories |
| **Working Changes** | `@git-changes` | `git status` output and diff of uncommitted changes | Only works in Git repositories |

### URL Mentions

{% image src="/docs/img/context-mentions/context-mentions-6.png" alt="URL mention example showing website content being converted to Markdown in the chat" width="600" caption="URL mentions import external web content and convert it to readable Markdown format." /%}

| Capability     | Details                                          |
| -------------- | ------------------------------------------------ |
| **Format**     | `@https://example.com`                           |
| **Processing** | Uses headless browser to fetch content           |
| **Cleaning**   | Removes scripts, styles, and navigation elements |
| **Output**     | Converts content to Markdown for readability     |
| **Limitation** | Complex pages may not convert perfectly          |

## How to Use Mentions

1. Type `@` in the chat input to trigger the suggestions dropdown
2. Continue typing to filter suggestions or use arrow keys to navigate
3. Select with Enter key or mouse click
4. Combine multiple mentions in a request: "Fix @problems in @/src/component.ts"

The dropdown automatically suggests:

- Recently opened files
- Visible folders
- Recent git commits
- Special keywords (`problems`, `terminal`, `git-changes`)

## Best Practices

| Practice                   | Description                                                                      |
| -------------------------- | -------------------------------------------------------------------------------- |
| **Use specific paths**     | Reference exact files rather than describing them                                |
| **Use relative paths**     | Always start from workspace root: `@/src/file.ts` not `@C:/Projects/src/file.ts` |
| **Verify references**      | Ensure paths and commit hashes are correct                                       |
| **Click mentions**         | Click mentions in chat history to open files or view content                     |
| **Eliminate copy-pasting** | Use mentions instead of manually copying code or errors                          |
| **Combine mentions**       | "Fix @problems in @/src/component.ts using the pattern from commit @a1b2c3d"     |

{% /tab %}
{% /tabs %}
