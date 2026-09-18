---
title: "Memory"
description: "Store useful project details that Kilo remembers across sessions"
---

# Memory

Kilo Memory lets Kilo remember useful details about a project across sessions, so you do not have to repeat decisions, constraints, environment setup, or corrections. It is opt-in and scoped to one project.

{% callout type="info" title="Opt-in and project-only" %}
Memory is disabled by default. Enable it per project. Kilo stores project memory only; personal or user-level memory is not supported.
{% /callout %}

{% callout type="note" title="Not the deprecated Memory Bank" %}
Kilo Memory is separate from the deprecated **memory bank**. The memory bank used rule files under `.kilo/rules/memory-bank/` and is replaced by [AGENTS.md](/docs/customize/agents-md). 
{% /callout %}

## What memory stores

Kilo keeps memory in three Markdown source files plus saved session digests:

| Source | Contains |
|---|---|
| `project.md` | Project facts, decisions, constraints, and open questions |
| `environment.md` | Commands, paths, and tooling details |
| `corrections.md` | Corrections to earlier memory |
| Session digests | Short summaries of prior sessions |

Each entry is a saved key-value note. Memory is saved per repository, so linked git worktrees share the same project memory.

These files live in a per-project folder under Kilo's global data directory: `<data>/memory/<project-slug>-<sha1-12>/`. On typical systems `<data>` is `~/.local/share/kilo` (respecting `XDG_DATA_HOME` if set), so the folder is `~/.local/share/kilo/memory/<project-slug>-<sha1-12>/`. The folder name is derived from the git project root: a slugified basename of the root directory, plus the first 12 hex characters of a sha1 hash of the canonical root path. Because the folder is keyed by the project root, all worktrees of the same repository share one memory folder.

Alongside the three source files, the folder holds a `sessions/` directory with saved session digest Markdown files, plus internal index and state files that Kilo manages automatically and that you should not edit by hand.

## Enable memory

{% tabs %}
{% tab label="VSCode" %}

Enable project memory in **Settings → Context** with the **Project memory** switch. The same section shows the storage location, an **Inspect** button, and an **Auto-save project memory** switch.

You can also run `/memory on` in chat, or use the Command Palette command **Kilo Code: Toggle Project Memory**.

{% /tab %}
{% tab label="CLI" %}

Run `/memory on` in the TUI. The Memory row in the sidebar shows the current state.

```text
/memory on
```

{% /tab %}
{% /tabs %}

## Automatic memory (auto-save)

When memory is enabled and auto-save is on, Kilo reviews completed turns and saves project facts and session digests automatically. Auto-save is on by default.

- Auto-save sends best-effort-redacted turn context to your configured model provider. Disable it with `/memory auto off` or the **Auto-save project memory** switch.
- Automatic saves only add or update memory. They never delete it.
- Secret-like content is filtered before it is written. Session digests are redacted, and project memory entries that match common secret patterns are discarded.
- Kilo throttles auto-save, so not every turn triggers a save.

Explicit saves are not throttled.

## Explicit memory

Use explicit commands when you want to control what is stored:

| Command | Effect |
|---|---|
| `/memory remember <text>` | Save a project memory note |
| `/memory correct <text>` | Save a correction to project memory |
| `/memory forget <query>` | Remove matching project memory |

Kilo can also manage memory itself through two tools:

| Tool | Purpose |
|---|---|
| `kilo_memory_save` | Save, correct, or forget memory when you ask Kilo to remember or update something |
| `kilo_memory_recall` | Search saved memory for details that are not in the injected index |

Both tools ask for approval by default. Recall can be allowed always; saving asks each time.

## How memory is used

At the start of a session, Kilo injects a compact memory index that summarizes what is stored. The index is a summary, not the full memory store, so Kilo can call `kilo_memory_recall` to fetch exact details on demand.

Recall supports four modes:

| Mode | Use |
|---|---|
| `search` | Search saved project memory and session digests |
| `typed` | Search saved project memory only |
| `digest` | Read saved session digests |
| `catalog` | List stored memory entries and session digests |

Memory is context, not instruction. Current messages, repository files, and [AGENTS.md](/docs/customize/agents-md) take precedence over saved memory.

## Command reference

The `/memory` command is also available as `/mem`.

| Command | Description |
|---|---|
| `/memory on` | Enable project memory |
| `/memory off` | Disable project memory |
| `/memory status` | Show the storage location and a stored memory overview |
| `/memory show` | Show stored project memory |
| `/memory remember <text>` | Save a project memory note |
| `/memory correct <text>` | Save a correction to project memory |
| `/memory forget <query>` | Remove matching project memory |
| `/memory auto on\|off` | Turn automatic memory saves on or off |
| `/memory inspect` | Reveal the project memory folder |
| `/memory rebuild` | Rebuild the memory index from source files |
| `/memory purge confirm` | Delete all project memory files |

## Storage and maintenance

Kilo stores project memory outside your repository, under Kilo's global data directory in a per-project folder (see [What memory stores](#what-memory-stores)). Run `/memory inspect` to reveal the exact folder for the current project.

- **Rebuild** regenerates the memory index from the source files. Use it if the index looks stale or incomplete.
- **Purge** permanently deletes all project memory files. It requires the explicit `confirm` argument: `/memory purge confirm`.

## Privacy

- Memory is stored locally and scoped to one project. Personal or user-level memory is not supported.
- Secret-like content is filtered before it is written. Session digests are redacted, and project memory entries that match common secret patterns are discarded.
- Auto-save sends best-effort-redacted turn context to your configured model provider. Turn it off with `/memory auto off` if you do not want automatic captures.
- Disabling memory stops injection, recall, and automatic capture. It does not delete stored memory.

## Related features

- [Context Condensing](/docs/customize/context/context-condensing) - Summarize conversation history to stay within context limits
- [Codebase Indexing](/docs/customize/context/codebase-indexing) - Semantic search across your codebase
- [AGENTS.md](/docs/customize/agents-md) - Persistent project instructions and context
