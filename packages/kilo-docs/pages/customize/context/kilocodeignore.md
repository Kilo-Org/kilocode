---
title: ".kilocodeignore"
description: "Control which files Kilo Code can access"
---

# .kilocodeignore

## Overview

`.kilocodeignore` is a root-level file that blocks Kilo Code's built-in file access for matching files and folders. It uses standard `.gitignore` pattern syntax, but it does not affect Git.

If no applicable `.kilocodeignore` file exists, normal permission rules determine workspace access.

## Quick Start

{% tabs %}
{% tab label="VSCode" %}

Use `.kilocodeignore` when a file must never be exposed through Kilo's built-in file tools or changed by them. Kilo applies a final ignored match as a hard deny, even when a permission rule, saved approval, or auto-approval would otherwise allow the operation.

Use the **permission system** in `kilo.jsonc` for the remaining tool access rules:

```json
{
  "permission": {
    "read": { "*.env": "deny", "*": "allow" },
    "edit": { "dist/**": "deny", "*": "allow" }
  }
}
```

You can also exclude paths from the file watcher separately using `watcher.ignore`:

```json
{
  "watcher": {
    "ignore": ["tmp/**", "logs/**"]
  }
}
```

{% /tab %}
{% tab label="CLI" %}

Use `.kilocodeignore` when a file must never be exposed through Kilo's built-in file tools or changed by them. Kilo applies a final ignored match as a hard deny, even when a permission rule, saved approval, or auto-approval would otherwise allow the operation.

Use the **permission system** in `kilo.jsonc` for the remaining tool access rules:

```json
{
  "permission": {
    "read": { "*.env": "deny", "*": "allow" },
    "edit": { "dist/**": "deny", "*": "allow" }
  }
}
```

You can also exclude paths from the file watcher separately using `watcher.ignore`:

```json
{
  "watcher": {
    "ignore": ["tmp/**", "logs/**"]
  }
}
```

{% /tab %}
{% /tabs %}

## Pattern Rules

`.kilocodeignore` follows the same rules as `.gitignore`:

- `#` starts a comment
- `*` and `**` match wildcards
- Trailing `/` matches directories only
- `!` negates a previous rule

Patterns are evaluated relative to the workspace root.

Kilo loads policies in this order: `~/.kilocode/.kilocodeignore` (legacy), `~/.kilo/.kilocodeignore`, then the workspace-root `.kilocodeignore`. Later Git-ignore rules take precedence, so a workspace rule can re-include a user-level ignored path. Kilo does not search parent directories or nested folders for additional `.kilocodeignore` files.

## What It Affects

{% tabs %}
{% tab label="VSCode" %}

`.kilocodeignore` hard-denies matching paths for built-in `read`, `write`, `edit`, `apply_patch`, image generation, notebook, repository-overview, instruction, skill, and plan-file paths. A matching path is blocked before Kilo returns its content, sends it to a provider, or changes it.

This is not a filesystem sandbox. Shell commands, MCP servers, plugins, language servers, and search/indexing tools can have separate access paths. Use an operating-system sandbox when those tools must not access sensitive data.

{% /tab %}
{% tab label="CLI" %}

`.kilocodeignore` hard-denies matching paths for built-in `read`, `write`, `edit`, `apply_patch`, image generation, notebook, repository-overview, instruction, skill, and plan-file paths. A matching path is blocked before Kilo returns its content, sends it to a provider, or changes it.

This is not a filesystem sandbox. Shell commands, MCP servers, plugins, language servers, and search/indexing tools can have separate access paths. Use an operating-system sandbox when those tools must not access sensitive data.

{% /tab %}
{% /tabs %}

## Configuration Details

{% tabs %}
{% tab label="VSCode" %}

### Permission Rules

Permission rules are defined per-tool in `kilo.jsonc`. Patterns are evaluated in order — the last matching rule wins:

```json
{
  "permission": {
    "read": {
      "*.env": "deny",
      "secrets/**": "deny",
      "*": "allow"
    },
    "edit": {
      "dist/**": "deny",
      "*.lock": "deny",
      "*": "allow"
    }
  }
}
```

### .kilocodeignore precedence

`.kilocodeignore` is evaluated separately from permission rules. A final ignored match denies built-in `read` and edit operations. A negated pattern removes only this hard deny; Kilo then evaluates the ordinary permission rules, which can still ask or deny.

Kilo checks both the requested path and its resolved target. A symlink cannot be used to bypass a rule for either path. Kilo reloads policy files for every protected operation, so changing a policy takes effect without a restart.

### File Watcher Exclusions

The `watcher.ignore` setting controls which paths the file watcher skips. This is separate from tool permissions and only affects change detection:

```json
{
  "watcher": {
    "ignore": ["tmp/**", "logs/**", ".build/**"]
  }
}
```

{% /tab %}
{% tab label="CLI" %}

### Permission Rules

Permission rules are defined per-tool in `kilo.jsonc`. Patterns are evaluated in order — the last matching rule wins:

```json
{
  "permission": {
    "read": {
      "*.env": "deny",
      "secrets/**": "deny",
      "*": "allow"
    },
    "edit": {
      "dist/**": "deny",
      "*.lock": "deny",
      "*": "allow"
    }
  }
}
```

### .kilocodeignore precedence

`.kilocodeignore` is evaluated separately from permission rules. A final ignored match denies built-in `read` and edit operations. A negated pattern removes only this hard deny; Kilo then evaluates the ordinary permission rules, which can still ask or deny.

Kilo checks both the requested path and its resolved target. A symlink cannot be used to bypass a rule for either path. Kilo reloads policy files for every protected operation, so changing a policy takes effect without a restart.

### File Watcher Exclusions

The `watcher.ignore` setting controls which paths the file watcher skips. This is separate from tool permissions and only affects change detection:

```json
{
  "watcher": {
    "ignore": ["tmp/**", "logs/**", ".build/**"]
  }
}
```

{% /tab %}
{% /tabs %}

## Checkpoints vs .kilocodeignore

Checkpoint tracking is separate from file access rules. Files blocked by `.kilocodeignore` or permission rules can still be checkpointed if they are not excluded by `.gitignore`. See the [Checkpoints](/docs/code-with-ai/features/checkpoints) documentation for details.

## Troubleshooting

- **Kilo can't access a file you want:** Remove or narrow the matching rule in `.kilocodeignore`, or adjust the permission rules in `kilo.jsonc` after checking that the file is not ignored.
- **A file still appears in lists:** In the legacy extension, check the setting that shows ignored files in lists and searches. In the extension & CLI, verify your permission and watcher ignore configuration.
- **`.kilocodeignore` patterns not working:** Ensure the file is at the workspace root and uses valid `.gitignore` syntax. Changes apply to the next built-in read or edit operation without restarting Kilo.
- **Kilo denies all protected files:** A policy file must be a regular UTF-8 file no larger than 1 MiB. Kilo fails closed when it cannot safely read one.
