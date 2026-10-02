---
title: "Files"
description: "Browse and edit your workspace files, mention them in chat, and open file links from the agent's responses in Kilo Desktop."
---

# Files

Browse and edit the files in your chat's workspace from a **Files** panel, so you can read and change code alongside the conversation. The panel is scoped to the workspace folder, so what you see matches what the agent is working with.

## Browse the workspace

The file tree shows the files in your workspace. You can:

- Search the tree to jump to a file by name.
- Refresh to re-scan the folder — the tree also updates on its own when files change on disk.
- See git status decorations (added, modified, deleted, renamed, or untracked) when the workspace is a git repository.

## Open and edit files

Select a file to open it in the editor with syntax highlighting.

- Notebook (`.ipynb`) files open in a [Notebook](/docs/desktop/features/notebooks) panel.
- Markdown (`.md`) files can be viewed in a {% svgIcon src="/docs/img/desktop/eye.svg" /%} rendered preview or {% svgIcon src="/docs/img/desktop/code.svg" /%} as source code, with links to other workspace files clickable inline.
- Images open in a preview.
- Files that can't be shown — such as binaries or very large files — open read-only or explain why they can't be previewed.

Save with `Cmd/Ctrl+S`. If the file changed on disk since you opened it, Kilo Desktop surfaces a conflict instead of overwriting, so you can reload the latest version, overwrite it with your changes, or cancel. Closing a file with unsaved changes prompts you first.

## Mention files in chat

Type `@` in the chat to search your workspace files and insert a mention. The mention resolves to the file's path, so the agent knows exactly which file you mean.

## Open file links from responses

When the agent references a file in its response — including a specific location, like `src/api.py:42` — it renders as a clickable link rather than plain text. Click it to open that file at that line in the Files panel.

The agent can also open a file for you directly, jumping to the relevant line.

## Open in another editor

Prefer your usual editor? Open the current file in an external editor you have installed, such as VS Code, Cursor, Zed, or a JetBrains IDE. Kilo Desktop remembers your preferred editor for next time.
