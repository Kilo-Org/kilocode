# CLI - Commands Feature

**Quick Navigation for AI Agents**

---

## Overview

20 CLI commands for Kilocode. Covers task management, configuration, sessions, and utilities.

**Source Location**: `cli/src/commands/`

---

## Task Commands

| Command | Purpose | File | Size |
|---------|---------|------|------|
| `new` | Create new task | `new.ts` | - |
| `tasks` | List/manage tasks | `tasks.ts` | 14KB |
| `checkpoint` | Checkpoint management | `checkpoint.ts` | 12KB |
| `condense` | Context condensation | `condense.ts` | - |

---

## Configuration Commands

| Command | Purpose | File | Size |
|---------|---------|------|------|
| `config` | Configuration | `config.ts` | - |
| `model` | Model selection | `model.ts` | 28KB |
| `provider` | Provider management | `provider.ts` | 6KB |
| `profile` | Profile management | `profile.ts` | - |
| `mode` | Mode switching | `mode.ts` | 3KB |

---

## Session Commands

| Command | Purpose | File | Size |
|---------|---------|------|------|
| `session` | Session management | `session.ts` | 12KB |
| `teams` | Team/org management | `teams.ts` | 8KB |

---

## Utility Commands

| Command | Purpose | File |
|---------|---------|------|
| `help` | Help system | `help.ts` |
| `clear` | Clear history | `clear.ts` |
| `theme` | Theme selection | `theme.ts` |
| `exit` | Exit CLI | `exit.ts` |

---

## Command Framework

| File | Purpose |
|------|---------|
| `core/parser.ts` | Command parsing |
| `core/registry.ts` | Command registry |
| `core/types.ts` | Command types |

---

## Usage

```bash
# Start interactive mode
kilocode

# Run specific command
kilocode config
kilocode model gpt-4
kilocode checkpoint list
```

---

[← Back to CLI](../../Feature-Index.md)
