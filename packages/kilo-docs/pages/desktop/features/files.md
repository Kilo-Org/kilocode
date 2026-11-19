---
title: "Files"
description: "Browse and edit your workspace files — including rendered Markdown, Mermaid, and data tables — mention them in chat, and open file links from the agent's responses in Kilo Desktop."
---

# Files

Browse and edit workspace files in a **Files** tab alongside your conversation. Open it with ⌘⇧E (macOS) / Ctrl+Shift+E (Windows/Linux).

## Browse the workspace

The file tree shows the files in your workspace. In a multi-folder workspace, choose a folder with **Workspace folder**. You can:

- Search the tree to jump to a file by name.
- Refresh to re-scan the folder — the tree also updates on its own when files change on disk.
- See git status decorations for files when the selected workspace folder is a git worktree root.

The tree includes hidden and gitignored files, but excludes the root `.git` directory and stops after 25,000 entries. It doesn't follow directory symlinks.

## Open and edit files

Select a file to open it in the editor with syntax highlighting.

- Notebook (`.ipynb`) files open in a [Notebook](/docs/desktop/features/notebooks) tab (requires sign-in).
- Markdown (`.md`, `.markdown`, `.mdown`) files open as source. Select {% svgIcon src="/docs/img/desktop/eye.svg" /%} **Show rendered Markdown** for a preview, or {% svgIcon src="/docs/img/desktop/code.svg" /%} **Show Markdown source** to edit. Links to other workspace files are clickable in the preview.
- Mermaid (`.mmd`, `.mermaid`) files open as a rendered diagram you can zoom and pan; switch to {% svgIcon src="/docs/img/desktop/code.svg" /%} source to edit them. A file opened at a specific line, such as from a link like `flow.mmd:12`, opens in the source view. Mermaid code blocks in Markdown files render as diagrams in the preview.
- HTML (`.html`, `.htm`) files open rendered in a [Browser](/docs/desktop/features/browser) tab.
- Images up to 10 MiB open in a preview you can zoom and pan, like the chat's [Viewer](/docs/desktop/quickstart#pages-and-diagrams-in-replies).
- **CSV** (`.csv`), **TSV** (`.tsv`), and **Parquet** (`.parquet`) files open as interactive tables. You can scroll, sort, and filter the data.
  - For CSV and TSV, select **Edit source** to edit the text and **Show as table** to switch back. Save as usual.
  - Parquet tables are read-only.
  - Table view supports files up to 64 MiB (Parquet) or 1 MiB (CSV/TSV), with limits of 1 million rows, 1,024 columns, and 512 MiB of decoded data. For larger CSV/TSV files, use **Show text preview** or open them in an external editor. A CSV or TSV opened at a specific line starts in source view.
- Text files over 1 MiB open as read-only previews of their first 1 MiB. Files that can't be shown, such as binaries or PDFs, explain why they can't be previewed.

Save with `Cmd/Ctrl+S`. If the file changed on disk since you opened it, Kilo Desktop surfaces a conflict instead of overwriting, so you can reload the latest version, overwrite it with your changes, or cancel. Closing a file with unsaved changes prompts you first.

## Mention files in chat

Type `@` in the chat to search workspace files and insert a mention. The search excludes gitignored files, `.git`, and workspace `.kilo/worktrees`. Mentions use relative paths for a single-folder workspace and absolute paths for multiple folders.

## Open file links from responses

File references in agent replies can appear as clickable links, including locations such as `src/api.py:42`. Select one to open it in the appropriate tab; for example, notebooks open in Notebook and HTML files in Browser. Not every plain-text reference becomes a link.

If a link isn't an exact path, Kilo Desktop searches for matching workspace paths. One match opens directly; several open a **Choose a file** picker. The search is bounded and excludes gitignored files, `.git`, and workspace `.kilo/worktrees`, so it may report that the search was incomplete. Links in rendered Markdown resolve relative to the Markdown file.

The agent can also open a file for you directly, jumping to the relevant line.

## Open in another editor

Prefer your usual editor? Open the current file in a supported external editor, such as VS Code, Cursor, Zed, or a JetBrains IDE. Its command must be available on Desktop's `PATH`. Kilo Desktop remembers your preferred editor for next time.
