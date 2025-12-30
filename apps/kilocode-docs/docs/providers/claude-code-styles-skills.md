# Claude Code Styles Skills

Kilo Code supports advanced code style and skills extraction for Claude models via Claude Code CLI. This section describes how Claude Code can:

- **Extract and enforce code style rules**: Automatically detect formatting, naming conventions, and documentation styles from your project or custom rules.
- **Skills Section**: Claude Code can analyze your codebase and summarize key coding skills, patterns, and best practices used in your project. This includes language-specific idioms, architectural choices, and preferred libraries.
- **Integration**: When using Claude Code, the agent will surface a "Skills" section in the UI, showing detected code styles and skills relevant to your project and model selection.
- **Customization**: You can further customize code style and skills extraction by adding Markdown files to `.kilocode/rules/` (e.g., `codestyle.md`, `skills.md`).

## Example

When you select Claude Code as your provider, the agent manager will show:

---

## Claude Code Styles Skills

- Indentation: 2 spaces
- Variable naming: camelCase
- Preferred libraries: React, Redux
- Documentation: JSDoc format
- Testing: Vitest, Jest

---

You can edit or extend these skills by updating your `.kilocode/rules/skills.md` or `.kilocode/rules/codestyle.md` files.

## How It Works

Claude Code uses advanced prompt engineering to extract and summarize code style and skills from your project, custom rules, and recent code changes. This helps ensure all generated code matches your team's standards and best practices.

For more details, see [Custom Rules](/advanced-usage/custom-rules) and [Claude Code Provider](/providers/claude-code).
