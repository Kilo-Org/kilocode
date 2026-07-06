---
title: "Agent Permissions"
description: "Configure Kilo Code agent permission rules for tools, shell commands, files, and subagents"
platform: new
---

# Agent Permissions

Agent permissions decide whether a tool call is allowed, asks for approval, or is denied.

This page focuses on Markdown agent files, where permission rules are written as YAML frontmatter under the `permission` key. For global defaults in `kilo.jsonc`, use the JSON examples in [Auto-Approving Actions](/docs/getting-started/settings/auto-approving-actions#glob-pattern-rules).

## Actions

Each permission rule uses one of these actions:

| Action | Behavior |
|---|---|
| `allow` | Run the matching tool call without asking. |
| `ask` | Prompt before running the matching tool call. |
| `deny` | Block the matching tool call. |

You can write each permission as one action for the whole tool or as a pattern map:

```yaml
permission:
  read: allow
  edit:
    "*": deny
    "*.md": allow
  bash:
    "*": ask
    "git status *": allow
```

## Rule Precedence

Permission rules are evaluated in config order. When more than one rule matches the requested permission and target pattern, the last matching rule wins.

Put broad fallbacks first and exceptions after them:

```yaml
permission:
  bash:
    "*": ask
    "uv *": allow
```

With that config, `uv pip install ...` is allowed because `uv *` appears after the catch-all `*`.

If you put the catch-all last, it overrides the earlier specific rule:

```yaml
permission:
  bash:
    "uv *": allow
    "*": ask
```

With that config, `uv pip install ...` asks because the later `*` rule also matches.

Top-level permission keys follow the same rule. For example, this lets `bash` override the global fallback:

```yaml
permission:
  "*": ask
  bash: allow
```

This does the opposite because the top-level `*` is later:

```yaml
permission:
  bash: allow
  "*": ask
```

## Patterns

Permission patterns use glob matching:

| Pattern | Matches |
|---|---|
| `*` | Any target for that permission. |
| `git *` | `git`, `git status`, `git log --oneline`, and other `git` commands. |
| `git status *` | `git status` with or without extra arguments. |
| `src/*` | Paths under `src/`. |
| `*.env` | Files ending in `.env`, including nested paths such as `apps/web/.env`. |

The matcher normalizes Windows backslashes to forward slashes before matching. On Windows, matching is case-insensitive; on Unix-like systems, matching is case-sensitive. Prefer forward slashes in config because they work across platforms.

`~`, `~/...`, `$HOME`, and `$HOME/...` at the start of a pattern are expanded to your home directory when the config is loaded.

## File Paths

File tools such as `read`, `edit`, and `write` resolve the input path first, then check permissions against the path relative to the current worktree.

For project files, use workspace-relative patterns:

```yaml
permission:
  read:
    "*": ask
    "docs/*": allow
    "src/generated/*": deny
  edit:
    "*": deny
    "*.md": allow
```

Absolute paths are mainly relevant for `external_directory` permissions and shell commands that touch paths outside the worktree.

## Shell Commands

The `bash` permission is checked against parsed shell command patterns. If a shell block contains multiple parsed commands, each relevant command must be permitted. A single denied command rejects the request.

For example:

```yaml
permission:
  bash:
    "*": ask
    "cd *": allow
    "git *": deny
```

For this command:

```bash
cd "/project"; git status
```

Kilo checks the parsed command patterns. The `git status` command matches `git *`, so the request is denied. Directory changes and commands that access paths outside the worktree can also trigger `external_directory` checks.

Built-in read-only agents include additional shell restrictions for write-like patterns such as output redirection, command substitution, pipes, and command chains. If you create your own read-only agent, prefer an explicit deny fallback and allow only the commands you trust:

```yaml
permission:
  bash:
    "*": deny
    "cat *": allow
    "grep *": allow
    "git status *": allow
    "git diff *": allow
```

## Sensitive Files

Kilo treats `.env` and `.env.*` reads as sensitive. Broad read approvals, such as `read: allow`, `read: { "*": allow }`, saved wildcard approvals, or allow-everything mode do not bypass the built-in prompt for these files. `.env.example` is treated as safe documentation and can be allowed by default.

Use explicit sensitive-file rules only when you intentionally want that behavior for a specific agent:

```yaml
permission:
  read:
    "*": allow
    "*.env": ask
    "*.env.*": ask
    "*.env.example": allow
```

## Subagent Delegation

Use `task` permission rules to control which subagents another agent may invoke:

```yaml
permission:
  task:
    "*": deny
    "code-reviewer": allow
    "docs-writer": allow
```

This allows delegation only to `code-reviewer` and `docs-writer`.

## Troubleshooting

- If a specific rule appears to be ignored, check whether a later catch-all also matches.
- If a broad allow does not apply to `.env`, this is expected sensitive-file protection.
- If a shell command asks unexpectedly, check whether it was parsed into more than one command pattern or triggered `external_directory`.
- If path rules behave differently across operating systems, write patterns with forward slashes and workspace-relative paths where possible.

## Related

- [Custom Modes](/docs/customize/custom-modes)
- [Custom Subagents](/docs/customize/custom-subagents)
- [Auto-Approving Actions](/docs/getting-started/settings/auto-approving-actions)
- [.kilocodeignore](/docs/customize/context/kilocodeignore)
- [Tool Use Overview](/docs/automate/tools)
