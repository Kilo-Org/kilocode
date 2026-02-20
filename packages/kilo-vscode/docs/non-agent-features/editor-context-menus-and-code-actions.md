# Editor Context Menus & Code Actions

Full spec of the VS Code-native menu, command, code action, keyboard shortcut, and prompt template system from the old Kilo Code extension. All of these need to be rebuilt in the new extension.

> **Note:** For webview-internal context menus (right-click inside the chat panel), see [Context Menus & Tooltips (Webview)](../chat-ui-features/context-menus-tooltips.md).  
> For SCM commit message generation, see [Git Commit Message Generation](git-commit-message-generation.md).  
> This document supersedes the old stub at [`code-actions.md`](code-actions.md).

---

## Overview

The old extension registered a comprehensive set of VS Code contributions:

- A **"Kilo Code" submenu** in the editor right-click context menu
- A **"Kilo Code" submenu** in the terminal right-click context menu
- A **CodeActionProvider** for lightbulb quick fixes
- **Keyboard shortcuts** for common actions
- **Prompt templates** (user-customizable) that turn captured context into agent task instructions

None of these exist yet in the rebuild.

---

## Editor Context Menus

Right-clicking in the editor shows a "Kilo Code" submenu with these commands:

| Command ID     | Label          | Captured Context                                  | Behavior                                                                 |
| -------------- | -------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| `explainCode`  | Explain Code   | File path, selected text, line range              | Starts an agent task with the EXPLAIN prompt                             |
| `fixCode`      | Fix Code       | File path, selected text, line range, diagnostics | Starts an agent task with the FIX prompt                                 |
| `improveCode`  | Improve Code   | File path, selected text, line range              | Starts an agent task with the IMPROVE prompt                             |
| `addToContext` | Add to Context | File path, selected text, line range              | Injects formatted code block into chat input (does **not** start a task) |

All commands use the VS Code editor API to capture the active editor's file path (`document.uri`), current selection (`editor.selection`), and the selected text. `fixCode` additionally captures diagnostics from `vscode.languages.getDiagnostics()` for the selection range.

---

## Terminal Context Menus

Right-clicking in the terminal shows a "Kilo Code" submenu:

| Command ID               | Label           | Captured Context                    | Behavior                                              |
| ------------------------ | --------------- | ----------------------------------- | ----------------------------------------------------- |
| `terminalAddToContext`   | Add to Context  | Terminal selection or recent buffer | Injects terminal output into chat input               |
| `terminalFixCommand`     | Fix Command     | Last executed command + output      | Starts an agent task with the TERMINAL_FIX prompt     |
| `terminalExplainCommand` | Explain Command | Last executed command + output      | Starts an agent task with the TERMINAL_EXPLAIN prompt |

Terminal context capture uses `vscode.window.activeTerminal` and the terminal selection API.

> See also [Terminal / Shell Integration](terminal-shell-integration.md) for the underlying terminal command execution and PTY management that these context menu actions depend on.

---

## Code Action Provider (Lightbulb Quick Fixes)

A `CodeActionProvider` is registered for all languages. When the user clicks the lightbulb or presses the quick fix shortcut:

| Condition                      | Actions shown                                       |
| ------------------------------ | --------------------------------------------------- |
| Always                         | **Add to Kilo Code** → triggers `addToContext`      |
| Diagnostics in selection range | **Fix with Kilo Code** → triggers `fixCode`         |
| No diagnostics                 | **Explain with Kilo Code** → triggers `explainCode` |
| No diagnostics                 | **Improve with Kilo Code** → triggers `improveCode` |

Controlled by the `enableCodeActions` extension setting (default: `true`).

---

## Keyboard Shortcuts

| Shortcut (Mac / Win+Linux)      | Command                   | Description                   |
| ------------------------------- | ------------------------- | ----------------------------- |
| `Cmd+Shift+A` / `Ctrl+Shift+A`  | Focus chat input          | Opens/focuses the chat panel  |
| `Cmd+K Cmd+A` / `Ctrl+K Ctrl+A` | Add selection to context  | Runs `addToContext`           |
| `Cmd+Shift+G` / `Ctrl+Shift+G`  | Generate terminal command | Starts TERMINAL_GENERATE task |
| `Cmd+Alt+A` / `Ctrl+Alt+A`      | Toggle auto-approve       | Toggles auto-approval setting |

---

## Prompt Templates

The old extension defined prompt templates in `support-prompt.ts` that format captured context into agent task instructions. Each template is user-customizable via extension settings.

| Template                  | Used by                   | Purpose                                                 |
| ------------------------- | ------------------------- | ------------------------------------------------------- |
| `EXPLAIN`                 | `explainCode`             | Ask the agent to explain the selected code              |
| `FIX`                     | `fixCode`                 | Ask the agent to fix code, including diagnostic details |
| `IMPROVE`                 | `improveCode`             | Ask the agent to improve/refactor selected code         |
| `ADD_TO_CONTEXT`          | `addToContext`            | Format a code block for injection into chat input       |
| `TERMINAL_ADD_TO_CONTEXT` | `terminalAddToContext`    | Format terminal output for injection into chat input    |
| `TERMINAL_FIX`            | `terminalFixCommand`      | Ask the agent to fix a failed terminal command          |
| `TERMINAL_EXPLAIN`        | `terminalExplainCommand`  | Ask the agent to explain a terminal command/output      |
| `TERMINAL_GENERATE`       | Generate terminal command | Ask the agent to generate a terminal command            |
| `COMMIT_MESSAGE`          | SCM integration           | Generate a commit message (tracked separately)          |

---

## Data Flow

There are two distinct patterns:

### 1. Action → Agent Task

Commands like `explainCode`, `fixCode`, `improveCode`, `terminalFixCommand`, and `terminalExplainCommand` follow this flow:

1. User triggers command (context menu, code action, or keybinding)
2. Extension captures context from VS Code APIs (editor selection, diagnostics, terminal buffer)
3. Extension fills in the prompt template with captured context
4. Extension sends the formatted prompt as a new message to the CLI session (creating a new task)

### 2. Action → Context Injection

Commands like `addToContext` and `terminalAddToContext` follow a different flow:

1. User triggers command
2. Extension captures context from VS Code APIs
3. Extension formats the context as a code block using the template
4. Extension posts a message to the webview to **set the chat input text** (not submit it)
5. User can review and edit before sending

---

## Implementation Notes for Rebuild

### `package.json` Contributions

Register in `contributes`:

- `submenus`: Define "Kilo Code" submenus for editor and terminal contexts
- `menus`: Register commands under `editor/context` and `terminal/context` menu groups
- `commands`: Register all command IDs with titles and icons
- `keybindings`: Register keyboard shortcuts with `key`, `mac`, and `when` clauses

> **Note:** [`package.json`](../../package.json) already has `contributes.commands` (8 commands) and `contributes.menus` (`view/title` + `editor/title` menus) registered. New commands, submenus, and keybindings should be **added alongside** the existing entries, not replace them.

### CodeActionProvider

- Register a `CodeActionProvider` for `*` (all languages)
- Check `vscode.languages.getDiagnostics()` to decide which actions to show
- Gate behind the `enableCodeActions` setting
- Return `CodeAction` instances with `command` set to the appropriate command ID

### Editor Context Capture

- `vscode.window.activeTextEditor` for file path, selection, document
- `editor.document.getText(selection)` for selected text
- `selection.start.line` / `selection.end.line` for line range
- `vscode.languages.getDiagnostics(document.uri)` filtered to selection range for `fixCode`

### Terminal Context Capture

- `vscode.window.activeTerminal` for the active terminal
- Terminal selection API for selected text in terminal
- Shell integration API for last command and its output (where available)

### Prompt Templates

Need an equivalent template system in the extension. Options:

- Hardcode templates with settings overrides (like the old extension)
- Delegate prompt construction to the CLI (if it supports parameterized task creation)

### "Add to Context" Pattern

The webview needs to handle an incoming message that **sets the chat input text** without submitting it. This requires:

- A new message type (e.g., `SetChatInput`) in the extension→webview protocol
- The `PromptInput` component to accept externally-set text

---

## Prompt Templates (Full Text)

Below are the exact prompt templates from the old extension's `src/shared/support-prompt.ts`. Each template uses `${variable}` interpolation. These are the defaults; users can customize any template via the `customSupportPrompts` extension setting.

> **Note:** The `diagnosticText` variable used in the FIX template is auto-generated from VS Code diagnostics using the format `- [source] message (code)`.

### EXPLAIN

**Variables:** `filePath`, `startLine`, `endLine`, `userInput`, `selectedText`

```
Explain the following code from file path ${filePath}:${startLine}-${endLine}
${userInput}

\`\`\`
${selectedText}
\`\`\`

Please provide a clear and concise explanation of what this code does, including:
1. The purpose and functionality
2. Key components and their interactions
3. Important patterns or techniques used
```

### FIX

**Variables:** `filePath`, `startLine`, `endLine`, `diagnosticText`, `userInput`, `selectedText`

```
Fix any issues in the following code from file path ${filePath}:${startLine}-${endLine}
${diagnosticText}
${userInput}

\`\`\`
${selectedText}
\`\`\`

Please:
1. Address all detected problems listed above (if any)
2. Identify any other potential bugs or issues
3. Provide corrected code
4. Explain what was fixed and why
```

### IMPROVE

**Variables:** `filePath`, `startLine`, `endLine`, `userInput`, `selectedText`

```
Improve the following code from file path ${filePath}:${startLine}-${endLine}
${userInput}

\`\`\`
${selectedText}
\`\`\`

Please suggest improvements for:
1. Code readability and maintainability
2. Performance optimization
3. Best practices and patterns
4. Error handling and edge cases

Provide the improved code along with explanations for each enhancement.
```

### ADD_TO_CONTEXT

**Variables:** `filePath`, `startLine`, `endLine`, `selectedText`

```
${filePath}:${startLine}-${endLine}
\`\`\`
${selectedText}
\`\`\`
```

### TERMINAL_ADD_TO_CONTEXT

**Variables:** `userInput`, `terminalContent`

```
${userInput}
Terminal output:
\`\`\`
${terminalContent}
\`\`\`
```

### TERMINAL_FIX

**Variables:** `userInput`, `terminalContent`

```
${userInput}
Fix this terminal command:
\`\`\`
${terminalContent}
\`\`\`

Please:
1. Identify any issues in the command
2. Provide the corrected command
3. Explain what was fixed and why
```

### TERMINAL_EXPLAIN

**Variables:** `userInput`, `terminalContent`

```
${userInput}
Explain this terminal command:
\`\`\`
${terminalContent}
\`\`\`

Please provide:
1. What the command does
2. Explanation of each part/flag
3. Expected output and behavior
```

### TERMINAL*GENERATE *(Kilo-specific addition)\_

**Variables:** `userInput`, `operatingSystem`, `currentDirectory`, `shell`

```
Generate a terminal command based on this description: "${userInput}"

Context:
- Operating System: ${operatingSystem}
- Current Directory: ${currentDirectory}
- Shell: ${shell}

Requirements:
1. Generate ONLY the command, no explanations or formatting
2. Ensure the command is safe and appropriate
3. Use common command-line tools and best practices
4. Consider the current working directory context
5. Return only the raw command that can be executed directly
```

### ENHANCE

**Variables:** `userInput`

```
Generate an enhanced version of this prompt (reply with only the enhanced prompt - no conversation, explanations, lead-in, bullet points, placeholders, or surrounding quotes):

${userInput}
```

### CONDENSE

**Variables:** none (system prompt for conversation summary)

```
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the conversation and supporting any continuing tasks.

Your summary should be structured as follows:
Context: The context to continue the conversation with. If applicable based on the current task, this should include:
  1. Previous Conversation: High level details about what was discussed throughout the entire conversation with the user. This should be written to allow someone to be able to follow the general overarching conversation flow.
  2. Current Work: Describe in detail what was being worked on prior to this request to summarize the conversation. Pay special attention to the more recent messages in the conversation.
  3. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for continuing with this work.
  4. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
  5. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  6. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks.

Example summary structure:
1. Previous Conversation:
  [Detailed description]
2. Current Work:
  [Detailed description]
3. Key Technical Concepts:
  - [Concept 1]
  - [Concept 2]
  - [...]
4. Relevant Files and Code:
  - [File Name 1]
    - [Summary of why this file is important]
    - [Summary of the changes made to this file, if any]
    - [Important Code Snippet]
  - [File Name 2]
    - [Important Code Snippet]
  - [...]
5. Problem Solving:
  [Detailed description]
6. Pending Tasks and Next Steps:
  - [Task 1 details & next steps]
  - [Task 2 details & next steps]
  - [...]

Output only the summary of the conversation so far, without any additional commentary or explanation.
```

### COMMIT*MESSAGE *(Kilo-specific addition, tracked separately in [git-commit-message-generation.md](git-commit-message-generation.md))\_

**Variables:** `customInstructions`, `gitContext`

````
# Conventional Commit Message Generator
## System Instructions
You are an expert Git commit message generator that creates conventional commit messages based on staged changes. Analyze the provided git diff output and generate appropriate conventional commit messages following the specification.

${customInstructions}

## CRITICAL: Commit Message Output Rules
- DO NOT include any internal status indicators or bracketed metadata (e.g. "[Status: Active]", "[Context: Missing]")
- DO NOT include any task-specific formatting or artifacts from other rules
- ONLY Generate a clean conventional commit message as specified below

${gitContext}

## Conventional Commits Format
Generate commit messages following this exact structure:
```
<type>[optional scope]: <description>
[optional body]
[optional footer(s)]
```

### Core Types (Required)
- **feat**: New feature or functionality (MINOR version bump)
- **fix**: Bug fix or error correction (PATCH version bump)

### Additional Types (Extended)
- **docs**: Documentation changes only
- **style**: Code style changes (whitespace, formatting, semicolons, etc.)
- **refactor**: Code refactoring without feature changes or bug fixes
- **perf**: Performance improvements
- **test**: Adding or fixing tests
- **build**: Build system or external dependency changes
- **ci**: CI/CD configuration changes
- **chore**: Maintenance tasks, tooling changes
- **revert**: Reverting previous commits

### Scope Guidelines
- Use parentheses: `feat(api):`, `fix(ui):`
- Common scopes: `api`, `ui`, `auth`, `db`, `config`, `deps`, `docs`
- For monorepos: package or module names
- Keep scope concise and lowercase

### Description Rules
- Use imperative mood ("add" not "added" or "adds")
- Start with lowercase letter
- No period at the end
- Maximum 50 characters
- Be concise but descriptive

### Body Guidelines (Optional)
- Start one blank line after description
- Explain the "what" and "why", not the "how"
- Wrap at 72 characters per line
- Use for complex changes requiring explanation

### Footer Guidelines (Optional)
- Start one blank line after body
- **Breaking Changes**: `BREAKING CHANGE: description`

## Analysis Instructions
When analyzing staged changes:
1. Determine Primary Type based on the nature of changes
2. Identify Scope from modified directories or modules
3. Craft Description focusing on the most significant change
4. Determine if there are Breaking Changes
5. For complex changes, include a detailed body explaining what and why
6. Add appropriate footers for issue references or breaking changes

For significant changes, include a detailed body explaining the changes.

Return ONLY the commit message in the conventional format, nothing else.
````

### NEW_TASK

**Variables:** `userInput`

```
${userInput}
```

---

### Already Done / Tracked Elsewhere

- **View title bar buttons**: ✅ Done ([#181](https://github.com/Kilo-Org/kilo/issues/181))
- **SCM commit message generation**: Tracked in [git-commit-message-generation.md](git-commit-message-generation.md)
