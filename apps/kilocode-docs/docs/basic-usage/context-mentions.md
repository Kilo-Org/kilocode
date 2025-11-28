# Context Mentions

Context mentions are a powerful way to provide Kilo Code with specific information about your project, allowing it to perform tasks more accurately and efficiently. You can use mentions to refer to files, folders, problems, and Git commits. Context mentions start with the `@` symbol.

<img src="/docs/img/context-mentions/context-mentions.png" alt="Context Mentions Overview - showing the @ symbol dropdown menu in the chat interface" width="600" />

_Context mentions overview showing the @ symbol dropdown menu in the chat interface._

## Types of Mentions

<img src="/docs/img/context-mentions/context-mentions-1.png" alt="File mention example showing a file being referenced with @ and its contents appearing in the conversation" width="600" />

_File mentions add actual code content into the conversation for direct reference and analysis._

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

<img src="/docs/img/context-mentions/context-mentions-1.png" alt="File mention example showing a file being referenced with @ and its contents appearing in the conversation" width="600" />

_File mentions incorporate source code with line numbers for precise references._
| Capability | Details |
|------------|---------|
| **Format** | `@/path/to/file.ts` (always start with `/` from workspace root) |
| **Provides** | Complete file contents with line numbers |
| **Supports** | Text files, PDFs, and DOCX files (with text extraction) |
| **Works in** | Initial requests, feedback responses, and follow-up messages |
| **Limitations** | Very large files may be truncated; binary files not supported |

### Folder Mentions

<img src="/docs/img/context-mentions/context-mentions-2.png" alt="Folder mention example showing directory contents being referenced in the chat" width="600" />

_Folder mentions display directory structure in a readable tree format._
| Capability | Details |
|------------|---------|
| **Format** | `@/path/to/folder/` (note trailing slash) |
| **Provides** | Hierarchical tree display with ├── and └── prefixes |
| **Includes** | Immediate child files and directories (not recursive) |
| **Best for** | Understanding project structure |
| **Tip** | Use with file mentions to check specific file contents |

### Problems Mention

<img src="/docs/img/context-mentions/context-mentions-3.png" alt="Problems mention example showing VS Code problems panel being referenced with @problems" width="600" />

_Problems mentions import diagnostics directly from VS Code's problems panel._
| Capability | Details |
|------------|---------|
| **Format** | `@problems` |
| **Provides** | All errors and warnings from VS Code's problems panel |
| **Includes** | File paths, line numbers, and diagnostic messages |
| **Groups** | Problems organized by file for better clarity |
| **Best for** | Fixing errors without manual copying |

### Terminal Mention

<img src="/docs/img/context-mentions/context-mentions-4.png" alt="Terminal mention example showing terminal output being included in Kilo Code's context" width="600" />

_Terminal mentions capture recent command output for debugging and analysis._

| Capability     | Details                                            |
| -------------- | -------------------------------------------------- |
| **Format**     | `@terminal`                                        |
| **Captures**   | Last command and its complete output               |
| **Preserves**  | Terminal state (doesn't clear the terminal)        |
| **Limitation** | Limited to visible terminal buffer content         |
| **Best for**   | Debugging build errors or analyzing command output |

### Git Mentions

<img src="/docs/img/context-mentions/context-mentions-5.png" alt="Git commit mention example showing commit details being analyzed by Kilo Code" width="600" />

_Git mentions provide commit details and diffs for context-aware version analysis._
| Type | Format | Provides | Limitations |
|------|--------|----------|------------|
| **Commit** | `@a1b2c3d` | Commit message, author, date, and complete diff | Only works in Git repositories |
| **Working Changes** | `@git-changes` | `git status` output and diff of uncommitted changes | Only works in Git repositories |

### URL Mentions

<img src="/docs/img/context-mentions/context-mentions-6.png" alt="URL mention example showing website content being converted to Markdown in the chat" width="600" />

_URL mentions import external web content and convert it to readable Markdown format._

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
