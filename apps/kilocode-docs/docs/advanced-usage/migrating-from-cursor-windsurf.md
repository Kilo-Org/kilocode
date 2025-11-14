---
sidebar_label: Migrating from Cursor or Windsurf
---

# Migrating from Cursor or Windsurf

This guide will help you migrate your custom rules, configurations, and workflows from Cursor or Windsurf to Kilo Code. This manual migration process is straightforward and typically takes just a few minutes per project.

## Overview

Kilo Code uses a flexible rules system that's compatible with common AI coding assistant patterns. Most rules from Cursor and Windsurf can be migrated with minimal changes, and many will work as-is.

### Key Differences

| Feature                 | Cursor                               | Windsurf                     | Kilo Code                     |
| ----------------------- | ------------------------------------ | ---------------------------- | ----------------------------- |
| **Project Rules**       | `.cursor/rules/*.mdc`                | Similar to Cursor            | `.kilocode/rules/*.md`        |
| **Legacy Rules**        | `.cursorrules`                       | `.windsurfrules` (if exists) | `.kilocoderules` (deprecated) |
| **Agent Rules**         | `AGENTS.md`                          | `AGENTS.md`                  | `AGENTS.md` ✅                |
| **Global Rules**        | Cursor settings (UI)                 | Settings (UI)                | `~/.kilocode/rules/*.md`      |
| **Rule Format**         | `.mdc` (YAML frontmatter + Markdown) | Similar to Cursor            | `.md` (Plain Markdown)        |
| **Mode-Specific Rules** | Not supported                        | Not supported                | `.kilocode/rules-{mode}/` ✅  |

## Understanding Cursor's Rules System

### Project Rules (`.cursor/rules/`)

Cursor stores project-specific rules in `.cursor/rules/` as `.mdc` files (Markdown with Configuration). Each file contains:

1. **YAML frontmatter** with metadata:

    - `description`: Brief description of the rule
    - `globs`: File patterns the rule applies to (optional)
    - `alwaysApply`: Whether the rule always applies (optional)

2. **Markdown content** with the actual rule instructions

**Example Cursor `.mdc` file:**

```mdc
---
description: TypeScript coding standards
globs: ["*.ts", "*.tsx"]
alwaysApply: true
---

# TypeScript Standards

- Always use TypeScript for new files
- Prefer functional components in React
- Use explicit return types for exported functions
```

### Legacy Rules (`.cursorrules`)

Older Cursor projects may use a single `.cursorrules` file at the project root. This is a plain text or Markdown file without metadata.

### AGENTS.md

Cursor supports `AGENTS.md` files at the project root, which provide high-level agent instructions. Kilo Code fully supports this format and will automatically load `AGENTS.md` files.

## Understanding Windsurf's Rules System

Windsurf uses a similar structure to Cursor:

- **Project Rules**: Typically stored in `.windsurf/rules/` or similar directory
- **Legacy Rules**: `.windsurfrules` file (if used)
- **AGENTS.md**: Supported at project root

The migration process for Windsurf is nearly identical to Cursor.

## Manual Migration Process

Follow these steps to migrate your rules from Cursor or Windsurf to Kilo Code:

#### Step 1: Identify Your Rules

1. **Check for project rules:**

    ```bash
    # Cursor
    ls -la .cursor/rules/

    # Windsurf
    ls -la .windsurf/rules/
    ```

2. **Check for legacy files:**

    ```bash
    ls -la .cursorrules .windsurfrules AGENTS.md
    ```

3. **Note any global rules** you've configured in Cursor/Windsurf settings (you'll need to recreate these manually)

#### Step 2: Create Kilo Code Rules Directory

```bash
mkdir -p .kilocode/rules
```

#### Step 3: Convert `.mdc` Files to `.md`

For each `.mdc` file in `.cursor/rules/`:

1. **Open the `.mdc` file** and review its content
2. **Extract the Markdown content** (everything after the YAML frontmatter)
3. **Optionally add metadata as a comment** at the top:

```markdown
<!--
Migrated from Cursor
Original file: typescript-standards.mdc
Description: TypeScript coding standards
Globs: ["*.ts", "*.tsx"]
-->

# TypeScript Standards

- Always use TypeScript for new files
- Prefer functional components in React
- Use explicit return types for exported functions
```

4. **Save as `.md`** in `.kilocode/rules/`:

```bash
# Example: converting typescript-standards.mdc
cp .cursor/rules/typescript-standards.mdc .kilocode/rules/typescript-standards.md
# Then edit to remove YAML frontmatter
```

#### Step 4: Migrate Legacy Rules Files

If you have a `.cursorrules` or `.windsurfrules` file:

```bash
# Copy to Kilo Code format
cp .cursorrules .kilocode/rules/legacy-rules.md

# Or create a new file with better organization
# Split the content into logical files in .kilocode/rules/
```

#### Step 5: Preserve AGENTS.md

`AGENTS.md` files work identically in Kilo Code - no conversion needed:

```bash
# If it doesn't exist, you're done
# If it exists, it will be automatically loaded by Kilo Code
```

#### Step 6: Migrate Global Rules

Global rules in Cursor/Windsurf are typically stored in application settings. To migrate them:

1. **Export your Cursor/Windsurf settings** (if possible)
2. **Create global Kilo Code rules directory:**

```bash
mkdir -p ~/.kilocode/rules
```

3. **Copy or recreate your global rules** as `.md` files in `~/.kilocode/rules/`

## Converting Rule Formats

### From Cursor `.mdc` to Kilo Code `.md`

**Before (Cursor `.mdc`):**

```mdc
---
description: React component patterns
globs: ["**/*.tsx", "**/*.jsx"]
alwaysApply: false
---

# React Component Guidelines

- Use functional components with hooks
- Prefer named exports
- Include PropTypes or TypeScript types
```

**After (Kilo Code `.md`):**

```markdown
# React Component Guidelines

- Use functional components with hooks
- Prefer named exports
- Include PropTypes or TypeScript types
```

**Note:** Kilo Code doesn't use YAML frontmatter or glob patterns in rule files. Rules apply to all interactions unless you use mode-specific rules (see below).

### Handling Glob Patterns

Cursor's `globs` metadata specifies which files a rule applies to. Kilo Code handles this differently:

- **Rule files don't have glob patterns** - rules apply to all interactions in their mode
- **File restrictions are set at the mode level** - custom modes can use `fileRegex` in their configuration to restrict which files can be edited
- **Mode-specific rules** load different rules for different modes (e.g., `.kilocode/rules-code/` only loads in Code mode)

If you need file-specific workflows similar to Cursor's globs, you have two options:

1. **Create a custom mode** with `fileRegex` restrictions (e.g., a "Docs" mode that only edits `.md` files) - see [Custom Modes](/features/custom-modes)
2. **Organize rules by concern** in separate files with descriptive names (e.g., `typescript-standards.md`, `react-patterns.md`)

**Example of `fileRegex` in a custom mode:**

```yaml
modes:
    - slug: docs
      name: Documentation Editor
      roleDefinition: You edit documentation files
      groups:
          - read
          - [edit, { fileRegex: '\\.md$', description: "Markdown files only" }]
          - ask
```

## Mode-Specific Rules (Kilo Code Exclusive)

Kilo Code supports mode-specific rules, which Cursor and Windsurf don't have. This powerful feature allows you to:

- Create rules that only apply in specific modes (e.g., "Code", "Debug", "Ask")
- Restrict file access per mode
- Customize AI behavior for different workflows

### Creating Mode-Specific Rules

After migrating your general rules, you can create mode-specific versions:

```bash
# Create mode-specific rules directory
mkdir -p .kilocode/rules-code
mkdir -p .kilocode/rules-debug

# Copy relevant rules
cp .kilocode/rules/typescript-standards.md .kilocode/rules-code/
cp .kilocode/rules/debugging-guidelines.md .kilocode/rules-debug/
```

See [Custom Modes](/features/custom-modes) for more details.

## Post-Migration Checklist

After migrating your rules:

- [ ] **Verify rules are loaded:** Open Kilo Code and check the Rules tab (law icon in bottom right)
- [ ] **Test rule application:** Ask Kilo Code to perform a task that should follow your rules
- [ ] **Review rule organization:** Consider splitting large rules into smaller, focused files
- [ ] **Update team documentation:** Inform your team about the new rules location
- [ ] **Add to version control:** Commit `.kilocode/rules/` to your repository
- [ ] **Remove old rules:** Once verified, you can remove `.cursor/rules/` or `.windsurf/rules/`

## Troubleshooting

### Rules Not Appearing

If your migrated rules aren't showing up:

1. **Check file locations:**

    - Project rules: `.kilocode/rules/*.md`
    - Global rules: `~/.kilocode/rules/*.md`

2. **Verify file format:**

    - Files should be `.md` (Markdown)
    - No YAML frontmatter (unless as comments)
    - Valid Markdown syntax

3. **Reload VS Code:**

    - Press `Cmd+R` (Mac) or `Ctrl+R` (Windows/Linux)
    - Or use Command Palette: "Developer: Reload Window"

4. **Check Rules UI:**
    - Click the law icon (⚖️) in the bottom right of Kilo Code panel
    - Verify rules are listed and enabled

### Metadata Loss

If you need to preserve Cursor's metadata (globs, descriptions):

1. **Add as comments** at the top of the `.md` file
2. **Document in rule content** itself
3. **Use custom modes** for file-specific rules

### Global Rules Not Migrating

Global rules from Cursor/Windsurf settings aren't automatically accessible. You'll need to:

1. **Manually recreate** them in `~/.kilocode/rules/`
2. **Export from Cursor/Windsurf** if they provide an export feature
3. **Document them** before migrating so you don't lose them

## Advanced: Custom Modes Migration

If you've customized Cursor's behavior significantly, consider creating [Custom Modes](/features/custom-modes) in Kilo Code:

1. **Identify your Cursor workflows** (e.g., "code review", "documentation", "testing")
2. **Create corresponding custom modes** in Kilo Code
3. **Assign mode-specific rules** to each mode
4. **Configure tool access** per mode (read-only, file restrictions, etc.)

This gives you more control than Cursor's rule system.

## Next Steps

- [Learn about Custom Rules](/advanced-usage/custom-rules)
- [Explore Custom Modes](/features/custom-modes)
- [Set up Custom Instructions](/advanced-usage/custom-instructions)
- [Join our Discord](https://kilocode.ai/discord) for migration support
