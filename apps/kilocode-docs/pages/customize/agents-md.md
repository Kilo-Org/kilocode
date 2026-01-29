---
title: "Agents.md"
description: "Project-level configuration with agents.md files"
---

# agents.md

AGENTS.md files provide a standardized way to configure AI agent behavior across different AI coding tools. They allow you to define project-specific instructions, coding standards, and guidelines that AI agents should follow when working with your codebase.

## What is AGENTS.md?

AGENTS.md is an open standard for configuring AI agent behavior in software projects. It's a simple Markdown file placed at the root of your project that contains instructions for AI coding assistants. The standard is supported by multiple AI coding tools, including Kilo Code, Cursor, and Windsurf.

Think of AGENTS.md as a "README for AI agents" - it tells the AI how to work with your specific project, what conventions to follow, and what constraints to respect.

## Why Use AGENTS.md?

- **Portability**: Works across multiple AI coding tools without modification
- **Version Control**: Lives in your repository alongside your code
- **Team Consistency**: Ensures all team members' AI assistants follow the same guidelines
- **Project-Specific**: Tailored to your project's unique requirements and conventions
- **Simple Format**: Plain Markdown - no special syntax or configuration required

## File Location and Naming

### Project-Level AGENTS.md

Place your AGENTS.md file at the **root of your project**:

```
my-project/
├── AGENTS.md          # Primary filename (recommended)
├── src/
├── package.json
└── README.md
```

**Supported filenames** (in order of precedence):

1. `AGENTS.md` (uppercase, plural - recommended)
2. `AGENT.md` (uppercase, singular - fallback)

:::warning Case Sensitivity
The filename must be uppercase (`AGENTS.md`), not lowercase (`agents.md`). This ensures consistency across different operating systems and tools.
:::

### Subdirectory AGENTS.md Files

You can also place AGENTS.md files in subdirectories to provide context-specific instructions:

```
my-project/
├── AGENTS.md                    # Root-level instructions
├── src/
│   └── backend/
│       └── AGENTS.md            # Backend-specific instructions
└── docs/
    └── AGENTS.md                # Documentation-specific instructions
```

When working in a subdirectory, Kilo Code will load both the root AGENTS.md and any subdirectory AGENTS.md files, with subdirectory files taking precedence for conflicting instructions.

## File Protection

Both `AGENTS.md` and `AGENT.md` are **write-protected files** in Kilo Code. This means:

- The AI agent cannot modify these files without explicit user approval
- You'll be prompted to confirm any changes to these files
- This prevents accidental modifications to your project's AI configuration

## Basic Syntax and Structure

AGENTS.md files use standard Markdown syntax. There's no required structure, but organizing your content with headers and lists makes it easier for AI models to parse and understand.

### Recommended Structure

```markdown
# Project Name

Brief description of the project and its purpose.

## Code Style

- Use TypeScript for all new files
- Follow ESLint configuration
- Use 2 spaces for indentation

## Architecture

- Follow MVC pattern
- Keep components under 200 lines
- Use dependency injection

## Testing

- Write unit tests for all business logic
- Maintain >80% code coverage
- Use Jest for testing

## Security

- Never commit API keys or secrets
- Validate all user inputs
- Use parameterized queries for database access
```

## Best Practices

- **Be specific and clear** - Use concrete rules like "limit cyclomatic complexity to < 10" instead of vague guidance like "write good code"
- **Include code examples** - Show patterns for error handling, naming conventions, or architecture decisions
- **Organize by category** - Group related guidelines under clear headers (Code Style, Architecture, Testing, Security)
- **Keep it concise** - Use bullet points and direct language; avoid long paragraphs
- **Update regularly** - Review and revise as your project's conventions evolve

## How AGENTS.md Works in Kilo Code

### Loading Behavior

When you start a task in Kilo Code:

1. Kilo Code checks for `AGENTS.md` or `AGENT.md` at the project root
2. If found, the content is loaded and included in the AI's context
3. The AI follows these instructions throughout the conversation
4. Changes to AGENTS.md take effect in new tasks (reload may be required)

### Interaction with Other Rules

AGENTS.md works alongside Kilo Code's other configuration systems:

| Feature                                                             | Scope   | Location                  | Purpose                                    | Priority    |
| ------------------------------------------------------------------- | ------- | ------------------------- | ------------------------------------------ | ----------- |
| **[Mode-specific Custom Rules](/docs/agent-behavior/custom-rules)** | Project | `.kilocode/rules-{mode}/` | Mode-specific rules and constraints        | 1 (Highest) |
| **[Custom Rules](/docs/agent-behavior/custom-rules)**               | Project | `.kilocode/rules/`        | Kilo Code-specific rules and constraints   | 2           |
| **AGENTS.md**                                                       | Project | Project root or subfolder | Cross-tool standard for project guidelines | 3           |
| **[Global Custom Rules](/docs/agent-behavior/custom-rules)**        | Global  | `~/.kilocode/rules/`      | Global Kilo Code rules                     | 4           |
| **[Custom Instructions](/docs/agent-behavior/custom-instructions)** | Global  | IDE settings              | Personal preferences across all projects   | 5 (Lowest)  |

### Enabling/Disabling AGENTS.md

AGENTS.md support is **enabled by default** in Kilo Code. To disable it, edit `settings.json`:

```json
{
	"kilocode.useAgentRules": false
}
```

## Related Features

- **[Custom Rules](/docs/agent-behavior/custom-rules)** - Kilo Code-specific rules with more control
- **[Custom Modes](/docs/agent-behavior/custom-modes)** - Specialized workflows with specific permissions
- **[Custom Instructions](/docs/agent-behavior/custom-instructions)** - Personal preferences across all projects
- **[Migrating from Cursor or Windsurf](/docs/advanced-usage/migrating-from-cursor-windsurf)** - Migration guide for other tools

## External Resources

- [AGENTS.md Specification](https://agents.md) - Official standard documentation
- [dotagent](https://github.com/johnlindquist/dotagent) - Universal converter tool for agent configuration files
- [awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules) - 700+ example rules you can adapt
