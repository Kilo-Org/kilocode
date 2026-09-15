## Commands (`.kilo/command/*.md`)

Markdown files with YAML frontmatter. The filename (minus `.md`) becomes the command name invoked via `/name`. Commands can live in `.kilo/`, legacy `.kilocode/`, and global config roots, with both `command/` and `commands/` directory names supported. See Config File Locations for the full search order.

```yaml
---
description: Run tests # optional, shown in command list
agent: code # optional, route to a specific agent
model: anthropic/claude-sonnet # optional, override model
subtask: true # optional, run as subtask
---
Run all tests in $1 and fix failures.
Use $ARGUMENTS for the full arg string.
Reference files with @file and shell output with !`cmd`.
```

Template variables: `$1`-`$N` (positional args), `$ARGUMENTS` (full string), `@file` (file contents), `` !`cmd` `` (shell output).

### Finding a named command

When asked where `/name` lives, do not search only the repo root. Search these roots explicitly, and use an explicit search `path` for each one:

1. `~/.config/kilo/`
2. `~/.kilo/`
3. `~/.kilocode/`
4. The `KILO_CONFIG_DIR` directory (if the env var is set)
5. project `.kilo/` and `.kilocode/` directories from the current working directory up to the worktree root

Use exact patterns first:

- `**/command/<name>.md`
- `**/commands/<name>.md`

If found, return the full path. If not found in those roots, explain that the command is not present in the loaded config paths.

## Agents (`.kilo/agent/*.md`)

Also loaded from legacy `.kilocode/` directories and plural `agents/` variants.

```yaml
---
description: When to use this agent
mode: primary # primary | subagent | all
model: anthropic/claude-sonnet # optional override
steps: 25 # max agentic iterations
hidden: false # hide from @ menu (subagent only)
color: "#FF5733" # hex or theme name
permission: # optional, agent-level permissions
  bash: allow
  edit:
    "src/**": allow
    "*": ask
---
System prompt for this agent.
```

`mode` values: `primary` = selectable as main agent, `subagent` = only via Task tool, `all` = both.

## Workflows (legacy)

Markdown files in `.kilo/workflows/` or `.kilocode/workflows/` (project-level) and `~/.kilo/workflows/` or `~/.kilocode/workflows/` (global). These are automatically converted to commands at startup. The filename (minus `.md`) becomes the command name. Project workflows override global ones with the same name.

## Skills

Additional skill directories and remote URLs:

```jsonc
{
  "skills": {
    "paths": ["./my-skills", "~/shared-skills"],
    "urls": ["https://example.com/.well-known/skills/"],
  },
}
```

Skills are markdown files at `skills/<name>/SKILL.md` (or `skill/<name>/SKILL.md`) with `name` and `description` in frontmatter. Discovered inside `.kilo/` and legacy `.kilocode/` directories.

For Config File Locations, load `skill({name:"kilo-config",reference:"configuration"})`.
