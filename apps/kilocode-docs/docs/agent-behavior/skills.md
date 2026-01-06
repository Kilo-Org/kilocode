# Skills

Kilo Code implements [Agent Skills](https://agentskills.io/), a lightweight, open format for extending AI agent capabilities with specialized knowledge and workflows.

## What Are Agent Skills?

Agent Skills package domain expertise, new capabilities, and repeatable workflows that agents can use. At its core, a skill is a folder containing a `SKILL.md` file with metadata and instructions that tell an agent how to perform a specific task.

This approach keeps agents fast while giving them access to more context on demand. When a task matches a skill's description, the agent reads the full instructions into context and follows them—optionally loading referenced files or executing bundled code as needed.

### Key Benefits

- **Self-documenting**: A skill author or user can read a `SKILL.md` file and understand what it does, making skills easy to audit and improve
- **Interoperable**: Skills work across any agent that implements the [Agent Skills specification](https://agentskills.io/specification)
- **Extensible**: Skills can range in complexity from simple text instructions to bundled scripts, templates, and reference materials
- **Shareable**: Skills are portable and can be easily shared between projects and developers

## How Skills Work in Kilo Code

Skills can be:

- **Generic** - Available in all modes
- **Mode-specific** - Only loaded when using a particular mode (e.g., `code`, `architect`)

The workflow is:

1. **Discovery**: Skills are scanned from designated directories when Kilo Code initializes
2. **Activation**: When a mode is active, relevant skills are included in the system prompt
3. **Execution**: The AI agent follows the skill's instructions for applicable tasks

## Skill Locations

Skills are loaded from multiple locations, allowing both personal skills and project-specific instructions.

### Global Skills (User-Level)

Located in `~/.kilocode/skills/`:

```
~/.kilocode/
├── skills/                    # Generic skills (all modes)
│   ├── my-skill/
│   │   └── SKILL.md
│   └── another-skill/
│       └── SKILL.md
├── skills-code/              # Code mode only
│   └── refactoring/
│       └── SKILL.md
└── skills-architect/         # Architect mode only
    └── system-design/
        └── SKILL.md
```

### Project Skills (Workspace-Level)

Located in `.kilocode/skills/` within your project:

```
your-project/
└── .kilocode/
    ├── skills/               # Generic skills for this project
    │   └── project-conventions/
    │       └── SKILL.md
    └── skills-code/          # Code mode skills for this project
        └── linting-rules/
            └── SKILL.md
```

## SKILL.md Format

The `SKILL.md` file uses YAML frontmatter followed by Markdown content containing the instructions:

```markdown
---
name: my-skill-name
description: A brief description of what this skill does and when to use it
---

# Instructions

Your detailed instructions for the AI agent go here.

These instructions will be included in the system prompt when:

1. The skill is discovered in a valid location
2. The current mode matches (or the skill is generic)

## Example Usage

You can include examples, guidelines, code snippets, etc.
```

### Frontmatter Fields

Per the [Agent Skills specification](https://agentskills.io/specification):

| Field           | Required | Description                                                                                           |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `name`          | Yes      | Max 64 characters. Lowercase letters, numbers, and hyphens only. Must not start or end with a hyphen. |
| `description`   | Yes      | Max 1024 characters. Describes what the skill does and when to use it.                                |
| `license`       | No       | License name or reference to a bundled license file                                                   |
| `compatibility` | No       | Environment requirements (intended product, system packages, network access, etc.)                    |
| `metadata`      | No       | Arbitrary key-value mapping for additional metadata                                                   |

### Example with Optional Fields

```markdown
---
name: pdf-processing
description: Extract text and tables from PDF files, fill forms, merge documents.
license: Apache-2.0
metadata:
    author: example-org
    version: 1.0.0
---

## How to extract text

1. Use pdfplumber for text extraction...

## How to fill forms

...
```

### Name Matching Rule

In Kilo Code, the `name` field **must match** the parent directory name:

```
✅ Correct:
skills/
└── frontend-design/
    └── SKILL.md  # name: frontend-design

❌ Incorrect:
skills/
└── frontend-design/
    └── SKILL.md  # name: my-frontend-skill  (doesn't match!)
```

## Optional Bundled Resources

While `SKILL.md` is the only required file, you can optionally include additional directories to support your skill:

```
my-skill/
├── SKILL.md           # Required: instructions + metadata
├── scripts/           # Optional: executable code
├── references/        # Optional: documentation
└── assets/            # Optional: templates, resources
```

These additional files can be referenced from your skill's instructions, allowing the agent to read documentation, execute scripts, or use templates as needed.

## Priority and Overrides

When multiple skills share the same name, Kilo Code uses these priority rules:

1. **Project skills override global skills** - A project skill with the same name takes precedence
2. **Mode-specific skills override generic skills** - A skill in `skills-code/` overrides the same skill in `skills/` when in Code mode

This allows you to:

- Define global skills for personal use
- Override them per-project when needed
- Customize behavior for specific modes

## When Skills Are Loaded

Skills are discovered when Kilo Code initializes:

- When VSCode starts
- When you reload the VSCode window (`Cmd+Shift+P` → "Developer: Reload Window")

Skills directories are monitored for changes to `SKILL.md` files. However, the most reliable way to pick up new skills is to reload VS or the Kilo Code extension.

**Adding or modifying skills requires reloading VSCode for changes to take effect.**

## Example: Creating a Skill

1. Create the skill directory:

    ```bash
    mkdir -p ~/.kilocode/skills/api-design
    ```

2. Create `SKILL.md`:

    ```markdown
    ---
    name: api-design
    description: REST API design best practices and conventions
    ---

    # API Design Guidelines

    When designing REST APIs, follow these conventions:

    ## URL Structure

    - Use plural nouns for resources: `/users`, `/orders`
    - Use kebab-case for multi-word resources: `/order-items`
    - Nest related resources: `/users/{id}/orders`

    ## HTTP Methods

    - GET: Retrieve resources
    - POST: Create new resources
    - PUT: Replace entire resource
    - PATCH: Partial update
    - DELETE: Remove resource

    ## Response Codes

    - 200: Success
    - 201: Created
    - 400: Bad Request
    - 404: Not Found
    - 500: Server Error
    ```

3. Reload VSCode to load the skill

4. The skill will now be available in all modes

## Mode-Specific Skills

To create a skill that only appears in a specific mode:

```bash
# For Code mode only
mkdir -p ~/.kilocode/skills-code/typescript-patterns

# For Architect mode only
mkdir -p ~/.kilocode/skills-architect/microservices
```

The directory naming pattern is `skills-{mode-slug}` where `{mode-slug}` matches the mode's identifier (e.g., `code`, `architect`, `ask`, `debug`).

## Using Symlinks

You can symlink skills directories to share skills across machines or from a central repository:

```bash
# Symlink entire skills directory
ln -s /path/to/shared/skills ~/.kilocode/skills

# Or symlink individual skills
ln -s /path/to/shared/api-design ~/.kilocode/skills/api-design
```

When using symlinks, the skill's `name` field must match the **symlink name**, not the target directory name.

## Finding Skills

There are community efforts to build and share agent skills. Some resources include:

- [Skills Marketplace](https://skillsmp.com/) - Community marketplace of skills
- [Skill Specification](https://agentskills.io/home) - Agent Skills specification

### Creating Your Own

Skills are simple Markdown files with frontmatter. Start with your existing prompt templates or instructions and convert them to the skill format.

## Troubleshooting

### Skill Not Loading?

1. **Check the Output panel**: Open `View` → `Output` → Select "Kilo Code" from dropdown. Look for skill-related errors.

2. **Verify frontmatter**: Ensure `name` exactly matches the directory name and `description` is present.

3. **Reload VSCode**: Skills are loaded at startup. Use `Cmd+Shift+P` → "Developer: Reload Window".

4. **Check file location**: Ensure `SKILL.md` is directly inside the skill directory, not nested further.

### Common Errors

| Error                           | Cause                                        | Solution                                         |
| ------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| "missing required 'name' field" | No `name` in frontmatter                     | Add `name: your-skill-name`                      |
| "name doesn't match directory"  | Mismatch between frontmatter and folder name | Make `name` match exactly                        |
| Skill not appearing             | Wrong directory structure                    | Verify path follows `skills/skill-name/SKILL.md` |

## Related

- [Custom Modes](/agent-behavior/custom-modes) - Create custom modes that can use specific skills
- [Custom Instructions](/agent-behavior/custom-instructions) - Global instructions vs. skill-based instructions
- [Custom Rules](/agent-behavior/custom-rules) - Project-level rules complementing skills
