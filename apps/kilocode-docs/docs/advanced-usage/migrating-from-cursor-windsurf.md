---
sidebar_label: Migrating from Cursor or Windsurf
---

# Migrating from Cursor or Windsurf

Quickly migrate your custom rules from Cursor or Windsurf to Kilo Code. The process typically takes just a few minutes per project.

**Last Updated**: November 2025

## Why Kilo Code's Rules System?

Kilo Code simplifies AI configuration while adding powerful new capabilities:

- **Simple format**: Plain Markdown files—no YAML frontmatter or GUI configuration required
- **Mode-specific rules**: Different rules for different workflows (Code, Debug, Ask, custom modes)
- **Better version control**: All configuration lives in your repository as readable Markdown
- **More control**: Custom modes let you define specialized workflows with their own rules and permissions

## Quick Migration Guide

Choose your current tool:

- [Migrating from Cursor](#migrating-from-cursor) → Skip to Cursor migration
- [Migrating from Windsurf](#migrating-from-windsurf) → Skip to Windsurf migration

## Migrating from Cursor

### What's Different in Kilo Code

| Cursor                                      | Kilo Code                                 | Key Difference                              |
| ------------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| `.cursor/rules/*.mdc` with YAML frontmatter | `.kilocode/rules/*.md` plain Markdown     | No YAML metadata required                   |
| `alwaysApply: true/false` metadata          | File location determines scope            | Scope controlled by directory structure     |
| `globs: ["*.ts"]` for file patterns         | Mode-specific directories or custom modes | File patterns handled via custom modes      |
| `description` for AI activation             | Clear file names and organization         | Relies on explicit file organization        |
| Global rules in UI settings                 | `~/.kilocode/rules/*.md` files            | Global rules stored as files in home folder |

### Migration Steps

**1. Identify your rules:**

```bash
ls -la .cursor/rules/        # Project rules
ls -la .cursorrules          # Legacy file (if present)
```

**2. Create Kilo Code directory:**

```bash
mkdir -p .kilocode/rules
```

**3. Convert `.mdc` files to `.md`:**

For each file in `.cursor/rules/`, remove the YAML frontmatter and keep just the Markdown content.

**Cursor format:**

```mdc
---
description: TypeScript coding standards
globs: ["*.ts", "*.tsx"]
alwaysApply: false
---

# TypeScript Standards
- Always use TypeScript for new files
- Prefer functional components in React
```

**Kilo Code format:**

```markdown
# TypeScript Standards

- Always use TypeScript for new files
- Prefer functional components in React
```

**4. Migrate in one command:**

```bash
# Copy all files
for file in .cursor/rules/*.mdc; do
  basename="${file##*/}"
  cp "$file" ".kilocode/rules/${basename%.mdc}.md"
done

# Then manually edit each file to remove YAML frontmatter (the --- section at the top)
```

**5. Migrate global rules:**

- Open `Cursor Settings → General → Rules for AI`
- Copy the text content
- Save to `~/.kilocode/rules/cursor-global.md`

**6. Handle legacy `.cursorrules`:**

```bash
cp .cursorrules .kilocode/rules/legacy-rules.md
```

### Converting Cursor's `globs` Patterns

Cursor's `globs` field specifies which files a rule applies to. Kilo Code handles this through **mode-specific directories** instead.

**Cursor approach:**

```mdc
---
globs: ["*.ts", "*.tsx"]
---
Rules for TypeScript files...
```

**Kilo Code approach (Option 1 - Mode-specific directory):**

```bash
mkdir -p .kilocode/rules-code
# Save TypeScript-specific rules here
```

**Kilo Code approach (Option 2 - Custom mode):**

```yaml
# .kilocodemodes (at project root)
- slug: typescript
  name: TypeScript
  roleDefinition: You work on TypeScript files
  groups:
      - read
      - [edit, { fileRegex: '\\.tsx?$' }]
      - ask
```

Then place rules in `.kilocode/rules-typescript/`

### Flattening Nested Cursor Rules

Cursor supports nested `.cursor/rules/` directories. Kilo Code uses flat structure with descriptive names:

```bash
# Cursor: .cursor/rules/backend/server/api-rules.mdc
# Kilo Code: .kilocode/rules/backend-server-api-rules.md
```

## Migrating from Windsurf

### What's Different in Kilo Code

| Windsurf                                                       | Kilo Code                      | Key Difference                              |
| -------------------------------------------------------------- | ------------------------------ | ------------------------------------------- |
| `.windsurf/rules/*.md`                                         | `.kilocode/rules/*.md`         | Same Markdown format                        |
| GUI configuration for activation modes                         | File location determines scope | Scope controlled by directory structure     |
| "Always On" mode (GUI)                                         | Place in `.kilocode/rules/`    | Rules stored as files, not GUI settings     |
| "Glob" mode (GUI)                                              | Mode-specific directories      | File patterns handled via mode directories  |
| 12,000 character limit per rule                                | No hard limit                  | No character limit on rule files            |
| Global rules in `~/.codeium/windsurf/memories/global_rules.md` | `~/.kilocode/rules/*.md`       | Global rules in home folder, multiple files |

### Migration Steps

**1. Identify your rules:**

```bash
ls -la .windsurf/rules/      # Project rules
ls -la .windsurfrules        # Legacy file (if present)
```

**2. Create Kilo Code directory:**

```bash
mkdir -p .kilocode/rules
```

**3. Copy files directly** (already Markdown):

```bash
cp .windsurf/rules/*.md .kilocode/rules/
```

**4. Migrate global rules:**

```bash
cp ~/.codeium/windsurf/memories/global_rules.md ~/.kilocode/rules/global-rules.md
```

**5. Handle legacy `.windsurfrules`:**

```bash
cp .windsurfrules .kilocode/rules/legacy-rules.md
```

**6. Split large rules if needed:**

If you had rules approaching the 12,000 character limit, split them:

```bash
# Instead of one large file:
# .windsurf/rules/all-conventions.md (11,500 chars)

# Split into focused files:
# .kilocode/rules/api-conventions.md
# .kilocode/rules/testing-standards.md
# .kilocode/rules/code-style.md
```

### Converting Windsurf's Activation Modes

Windsurf configures activation through the GUI. In Kilo Code, file organization replaces GUI configuration:

| Windsurf GUI Mode        | Kilo Code Equivalent                                        |
| ------------------------ | ----------------------------------------------------------- |
| **Always On**            | Place in `.kilocode/rules/` (default)                       |
| **Glob** (file patterns) | Mode-specific directory or custom mode                      |
| **Model Decision**       | Clear file names by concern (e.g., `testing-guidelines.md`) |
| **Manual**               | Organize with descriptive names                             |

**Example - Converting a Glob rule:**

If you had a rule in Windsurf with Glob mode set to `*.test.ts`, create a custom test mode:

```yaml
# .kilocodemodes (at project root)
- slug: test
  name: Testing
  roleDefinition: You write and maintain tests
  groups:
      - read
      - [edit, { fileRegex: '\\.(test|spec)\\.(ts|js)$' }]
      - ask
```

Then place the rule in `.kilocode/rules-test/`

## AGENTS.md Support

All three tools support the `AGENTS.md` standard. If you have one, it works in Kilo Code automatically:

```bash
# Verify it exists
ls -la AGENTS.md

# That's it - Kilo Code loads it automatically (enabled by default)
```

**Important:** Use uppercase `AGENTS.md` (not `agents.md`).

**Note:** `AGENTS.md` is a write-protected file in Kilo Code and requires user approval to modify.

## Understanding Mode-Specific Rules

This is Kilo Code's unique feature that replaces both Cursor's `globs` and Windsurf's activation modes.

### Directory Structure

```bash
.kilocode/rules/              # Apply to ALL modes
.kilocode/rules-code/         # Only in Code mode
.kilocode/rules-debug/        # Only in Debug mode
.kilocode/rules-ask/          # Only in Ask mode
.kilocode/rules-{custom}/     # Only in your custom mode
```

### Real-World Example

**From Cursor:**

```mdc
---
description: Testing best practices
globs: ["**/*.test.ts", "**/*.spec.ts"]
---
# Testing Rules
- Write tests for all features
- Maintain >80% coverage
```

**To Kilo Code:**

```bash
# 1. Create test mode directory
mkdir -p .kilocode/rules-test

# 2. Save rule as plain Markdown
cat > .kilocode/rules-test/testing-standards.md << 'EOF'
# Testing Rules
- Write tests for all features
- Maintain >80% coverage
EOF

# 3. Define the mode (optional - creates a custom mode)
# Add to .kilocode/config.yaml:
# modes:
#   - slug: test
#     name: Test Mode
#     groups: [read, edit, ask]
```

## Post-Migration Checklist

After migration:

- [ ] **Verify rules loaded:** Click law icon (⚖️) in Kilo Code panel
- [ ] **Test rule application:** Ask Kilo Code to perform tasks following your rules
- [ ] **Organize rules:** Split large files, use clear names
- [ ] **Set up mode-specific rules:** Create directories for specialized workflows
- [ ] **Update team docs:** Document new `.kilocode/rules/` location
- [ ] **Commit to version control:** `git add .kilocode/`
- [ ] **Remove old directories:** Delete `.cursor/` or `.windsurf/` folders once verified

## Troubleshooting

### Rules Not Appearing

**Check file location:**

```bash
ls -la .kilocode/rules/      # Project rules
ls -la ~/.kilocode/rules/    # Global rules
```

**Verify file format:**

- Can be any text file extension (`.md`, `.txt`, etc.) - binary files are automatically filtered out
- Remove all YAML frontmatter from Cursor files
- Ensure files are not cache/temp files (`.cache`, `.tmp`, `.log`, `.bak`, etc.)

**Reload VS Code:**

- `Cmd+R` (Mac) or `Ctrl+R` (Windows/Linux)
- Or: Command Palette → "Developer: Reload Window"

### Cursor Metadata Lost

Cursor's `globs`, `alwaysApply`, and `description` don't transfer automatically. Solutions:

- **For file patterns:** Use mode-specific directories or custom modes
- **For always-on rules:** Place in `.kilocode/rules/`
- **For context-specific rules:** Use clear file names and organization

### Windsurf Activation Modes Lost

Windsurf's GUI activation modes (Always On/Glob/Model Decision/Manual) aren't stored in files. Solutions:

- **Before migrating:** Document each rule's activation mode
- **After migrating:** Organize files accordingly in Kilo Code

### Nested Rules Flattened

Cursor's nested directories don't map to Kilo Code. Flatten with descriptive names:

```bash
# Bad: .cursor/rules/backend/api/rules.mdc
# Good: .kilocode/rules/backend-api-rules.md
```

### AGENTS.md Not Loading

- **Verify filename:** Must be `AGENTS.md` (uppercase)
- **Check location:** Must be at project root (or inside the subproject directory you’re working in)
- **Check setting:** Verify "Use Agent Rules" is enabled in Kilo Code settings (enabled by default)
- **Reload:** Restart VS Code if needed

## Advanced: Creating Custom Modes

For complex workflows, define custom modes with their own rules and permissions:

```yaml
# .kilocodemodes (at project root)
- slug: review
  name: Code Review
  roleDefinition: You review code and suggest improvements
  groups:
      - read
      - ask
      # Note: No edit permission - review mode is read-only

- slug: docs
  name: Documentation
  roleDefinition: You write and maintain documentation
  groups:
      - read
      - [edit, { fileRegex: '\\.md$', description: "Markdown files only" }]
      - ask
```

Then create corresponding rule directories:

```bash
mkdir -p .kilocode/rules-review
mkdir -p .kilocode/rules-docs
```

**Note:** `.kilocodemodes` can be in YAML (preferred) or JSON format. For global modes, edit the `custom_modes.yaml` file via Settings > Edit Global Modes.

## Next Steps

- [Learn about Custom Rules](/agent-behavior/custom-rules)
- [Explore Custom Modes](/agent-behavior/custom-modes)
- [Set up Custom Instructions](/agent-behavior/custom-instructions)
- [Join our Discord](https://kilo.ai/discord) for migration support

## Additional Resources

### Community Examples

**Cursor users:**

- [awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules) - 700+ examples you can adapt

**Windsurf users:**

- [Official Rules Directory](https://windsurf.com/editor/directory)
- [windsurfrules](https://github.com/kinopeee/windsurfrules)

**Cross-tool:**

- [AGENTS.md Specification](https://agents.md)
- [dotagent](https://github.com/johnlindquist/dotagent) - Universal converter tool
