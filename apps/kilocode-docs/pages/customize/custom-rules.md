---
title: "Custom Rules"
description: "Define custom rules for Kilo Code behavior"
---

# Custom Rules

Custom rules provide a powerful way to define project-specific and global behaviors and constraints for the Kilo Code AI agent. With custom rules, you can ensure consistent formatting, restrict access to sensitive files, enforce coding standards, and customize the AI's behavior for your specific project needs or across all projects.

## Overview

Custom rules allow you to create text-based instructions that all AI models will follow when interacting with your project. These rules act as guardrails and conventions that are consistently respected across all interactions with your codebase. Rules can be managed through both the file system and the built-in UI interface.

## Rule Format

Custom rules can be written in plain text, but Markdown format is recommended for better structure and comprehension by the AI models. The structured nature of Markdown helps the models parse and understand your rules more effectively.

- Use Markdown headers (`#`, `##`, etc.) to define rule categories
- Use lists (`-`, `*`) to enumerate specific items or constraints
- Use code blocks (` `) to include code examples when needed

## Rule Types

Kilo Code supports two types of custom rules:

- **Project Rules**: Apply only to the current project workspace
- **Global Rules**: Apply across all projects and workspaces

:::note UI Support
The built-in rules management UI is available for general rules only. Mode-specific rules must be managed through the file system.
:::

## Rule Location

### Project Rules

Custom rules are primarily loaded from the **`.kilocode/rules/` directory**. This is the recommended approach for organizing your project-specific rules. Each rule is typically placed in its own Markdown file with a descriptive name:

```
project/
├── .kilocode/
│   ├── rules/
│   │   ├── formatting.md
│   │   ├── restricted_files.md
│   │   └── naming_conventions.md
├── src/
└── ...
```

### Global Rules

Global rules are stored in your home directory and apply to all projects:

```
~/.kilocode/
├── rules/
│   ├── coding_standards.md
│   ├── security_guidelines.md
│   └── documentation_style.md
```

## Managing Rules Through the UI

Kilo Code provides a built-in interface for managing your custom rules without manually editing files in the `.kilocode/rules/` directories. To access the UI, click on the <Codicon name="law" /> icon in the **bottom right corner** of the Kilo Code window.

You can access the rules management UI to:

- View all active rules (both project and global)
- Toggle rules on/off without deleting them
- Create and edit rules directly in the interface
- Organize rules by category and priority

## Rule Loading Order

### General Rules (Any Mode)

Rules are loaded in the following priority order:

1. **Global rules** from `~/.kilocode/rules/` directory
2. **Project rules** from `.kilocode/rules/` directory
3. **Legacy fallback files** (for backward compatibility):
    - `.roorules`
    - `.clinerules`
    - `.kilocoderules` (deprecated)

When both global and project rules exist, they are combined with project rules taking precedence over global rules for conflicting directives.

:::note
We strongly recommend keeping your rules in the `.kilocode/rules/` folder as it provides better organization and is the preferred approach for future versions. The folder-based structure allows for more granular rule organization and clearer separation of concerns. The legacy file-based approach is maintained for backward compatibility but may be subject to change in future releases.
:::

### Mode-Specific Rules

Additionally, the system supports mode-specific rules, which are loaded separately and have their own priority order:

1. First, it checks for `.kilocode/rules-${mode}/` directory
2. If that doesn't exist or is empty, it falls back to `.kilocoderules-${mode}` file (deprecated)

Currently, mode-specific rules are only supported at the project level.
When both generic rules and mode-specific rules exist, the mode-specific rules are given priority in the final output.

## Creating Custom Rules

### Using the UI Interface

<img src="/docs/img/custom-rules/rules-ui.png" alt="Rules tab in Kilo Code" width="400" />

The easiest way to create and manage rules is through the built-in UI:

1. Access the rules management interface from the Kilo Code panel
2. Choose between creating project-specific or global rules
3. Use the interface to create, edit, or toggle rules
4. Rules are automatically saved and applied immediately

### Using the File System

To create rules manually:

**For Project Rules:**

1. Create the `.kilocode/rules/` directory if it doesn't already exist
2. Create a new Markdown file with a descriptive name in this directory
3. Write your rule using Markdown formatting
4. Save the file

**For Global Rules:**

1. Create the `~/.kilocode/rules/` directory if it doesn't already exist
2. Create a new Markdown file with a descriptive name in this directory
3. Write your rule using Markdown formatting
4. Save the file

Rules will be automatically applied to all future Kilo Code interactions. Any new changes will be applied immediately.

## Example Rules

### Example 1: Table Formatting

```markdown
# Tables

When printing tables, always add an exclamation mark to each column header
```

This simple rule instructs the AI to add exclamation marks to all table column headers when generating tables in your project.

### Example 2: Restricted File Access

```markdown
# Restricted files

Files in the list contain sensitive data, they MUST NOT be read

- supersecrets.txt
- credentials.json
- .env
```

This rule prevents the AI from reading or accessing sensitive files, even if explicitly requested to do so.

<img src="/docs/img/custom-rules/custom-rules.png" alt="Kilo Code ignores request to read sensitive file" width="600" />

## Use Cases

Custom rules can be applied to a wide variety of scenarios:

- **Code Style**: Enforce consistent formatting, naming conventions, and documentation styles
- **Security Controls**: Prevent access to sensitive files or directories
- **Project Structure**: Define where different types of files should be created
- **Documentation Requirements**: Specify documentation formats and requirements
- **Testing Patterns**: Define how tests should be structured
- **API Usage**: Specify how APIs should be used and documented
- **Error Handling**: Define error handling conventions

## Examples of Custom Rules

- "Strictly follow code style guide [your project-specific code style guide]"
- "Always use spaces for indentation, with a width of 4 spaces"
- "Use camelCase for variable names"
- "Write unit tests for all new functions"
- "Explain your reasoning before providing code"
- "Focus on code readability and maintainability"
- "Prioritize using the most common library in the community"
- "When adding new features to websites, ensure they are responsive and accessible"

## Best Practices

- **Be Specific**: Clearly define the scope and intent of each rule
- **Use Categories**: Organize related rules under common headers
- **Separate Concerns**: Use different files for different types of rules
- **Use Examples**: Include examples to illustrate the expected behavior
- **Keep It Simple**: Rules should be concise and easy to understand
- **Update Regularly**: Review and update rules as project requirements change

:::tip Pro Tip: File-Based Team Standards
When working in team environments, placing `.kilocode/rules/codestyle.md` files under version control allows you to standardize Kilo's behavior across your entire development team. This ensures consistent code style, documentation practices, and development workflows for everyone on the project.
:::

## Limitations

- Rules are applied on a best-effort basis by the AI models
- Complex rules may require multiple examples for clear understanding
- Project rules apply only to the project in which they are defined
- Global rules apply across all projects

## Troubleshooting

If your custom rules aren't being properly followed:

1. **Check rule status in the UI**: Use the rules management interface to verify that your rules are active and properly loaded
1. **Verify rule formatting**: Ensure that your rules are properly formatted with clear Markdown structure
1. **Check rule locations**: Ensure that your rules are located in supported locations:
    - Global rules: `~/.kilocode/rules/` directory
    - Project rules: `.kilocode/rules/` directory
    - Legacy files: `.kilocoderules`, `.roorules`, or `.clinerules`
1. **Rule specificity**: Verify that the rules are specific and unambiguous
1. **Restart VS Code**: Restart VS Code to ensure the rules are properly loaded

## Related Features

- [Custom Modes](/docs/features/custom-modes)
- [Custom Instructions](/advanced-usage/custom-instructions)
- [Settings Management](/docs/features/settings-management)
- [Auto-Approval Settings](/docs/features/auto-approving-actions)
