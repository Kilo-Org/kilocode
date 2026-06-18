---
name: gh-issues
description: Use when creating, triaging, or commenting on GitHub issues for the Kilo VS Code extension or JetBrains plugin via `gh`. Covers issue templates, project board assignment, title conventions, and required `gh` scopes.
---

# GitHub Issues

Use this skill whenever you create or manage a GitHub issue with `gh` for either the VS Code extension or the JetBrains plugin.

## Templates

The repo defines issue templates in `.github/ISSUE_TEMPLATE/`. Pick the matching template instead of opening a blank issue:

| Template | When to use |
|---|---|
| `Bug report` (`bug-report.yml`) | Reproducible defects with steps, expected, and actual behavior |
| `Feature Request` (`feature-request.yml`) | New capabilities, enhancements, or behavior changes |
| `Question` (`question.yml`) | Usage or design questions that aren't obviously bugs or feature requests |

Pass the template title to `gh issue create --template`.

## Title Conventions

- Use a plain, descriptive title that reads cleanly as a standalone sentence.
- Do not add platform-specific prefixes such as `[JetBrains]`, `[Jetbrains]`, `[JB]`, `[VS Code]`, `[VSCode]`, or similar. Routing happens through project boards, not the title.

## Project Boards

Every new issue must land on the correct project board:

| Surface | Project | URL |
|---|---|---|
| VS Code extension | `VS Code Extension` | https://github.com/orgs/Kilo-Org/projects/25 |
| JetBrains plugin | `Jetbrains Plugin` | https://github.com/orgs/Kilo-Org/projects/39 |

Pass the project title to `gh issue create --project`.

## Recipes

Create a VS Code extension bug report and add it to the board:

```bash
gh issue create \
  --template "Bug report" \
  --project "VS Code Extension" \
  --title "Sidebar chat fails to render after reload" \
  --body "..."
```

Create a JetBrains feature request:

```bash
gh issue create \
  --template "Feature Request" \
  --project "Jetbrains Plugin" \
  --title "Support Kotlin Multiplatform target detection" \
  --body "..."
```

## Scope Errors

If `gh` reports a missing scope when assigning a project, refresh the auth token and retry:

```bash
gh auth refresh -s project
```

After the refresh succeeds, re-run the original `gh issue create` command. Do not fall back to creating the issue without the project — the board assignment is required.
