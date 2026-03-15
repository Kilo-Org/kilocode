---
title: "Git Commit Generation"
description: "Automatically generate meaningful git commit messages"
---

# Generate Commit Messages

Generate descriptive commit messages automatically based on your staged git changes. Kilo Code analyzes your staged files and creates conventional commit messages that follow best practices.

{% callout type="info" %}
This feature only analyzes **staged changes**. Make sure to stage your files using `git add` or via `VS Code` interface before generating commit messages.
{% /callout %}

## How It Works

The git commit message generator:

- Analyzes only your **staged changes** (not unstaged or untracked files)
- Uses AI to understand the context and purpose of your changes
- Creates descriptive commit messages that explain what was changed and why following the [Conventional Commits](https://www.conventionalcommits.org/) (by default, customizable)

## Using the Feature

### Generating a Commit Message

1. Stage your changes using `git add` or the VS Code git interface
2. In the VS Code Source Control panel, look for the `Kilo Code` logo next to the commit message field)
3. Click the logo to generate a commit message

The generated message will appear in the commit message field, ready for you to review and modify if needed.

{% image src="/docs/img/git-commit-generation/git-commit-1.png" alt="Generated commit message example" width="600" /%}

### Conventional Commit Format

By default, generated messages follow the Conventional Commits specification:

```
<type>(<scope>): <description>

<body>
```

Common types include:

- `feat`: New features
- `fix`: Bug fixes
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

## Configuration

### Customizing via AGENTS.md

You can define commit message instructions in a markdown file with a `## Commit Message` section:

```markdown
## Commit Message

- Use emoji prefixes (✨ for features, 🐛 for fixes)
- Keep subject line under 50 characters
- Use imperative mood
```

The generator searches upward from the current path to the git root in this order:

1. `AGENTS.md`, `CLAUDE.md`, or `CONTEXT.md` in each directory it checks (looks for a `## Commit Message` section)
2. `.kilocode/commit-instructions.md` in each directory it checks (uses the entire file content)

The first file found with valid instructions wins, so package-level files can override repo-root instructions.

{% callout type="info" %}
Nested workspace and package-level instruction files are supported.
{% /callout %}

This approach is useful for:

- Project-specific conventions that apply to all team members
- Version-controlled instructions that travel with your codebase
- Sharing commit conventions across different AI tools

### API Configuration

You can configure which API profile to use for commit message generation:

1. In the `Prompts` settings, scroll to "API Configuration"
2. Select a specific profile or use the currently selected one

{% callout type="tip" %}
Consider creating a dedicated [API configuration profile](/docs/ai-providers) with a faster, more cost-effective model specifically for commit message generation.
{% /callout %}

## Best Practices

### Staging Strategy

- Stage related changes together for more coherent commit messages
- Avoid staging unrelated changes in a single commit
- Use `git add -p` for partial file staging when needed

### Message Review

- Always review generated messages before committing
- Edit messages to add context the AI might have missed
- Ensure the message accurately describes the changes

### Custom Instructions

- Define project-specific commit message conventions in AGENTS.md
- Include team-specific terminology or formatting requirements
- Add instructions for handling different types of changes

## Example Generated Messages

Here are examples of messages the feature might generate:

```
feat(auth): add OAuth2 integration with Google

Implement Google OAuth2 authentication flow including:
- OAuth2 client configuration
- User profile retrieval
- Token refresh mechanism
```

```
fix(api): resolve race condition in user data fetching

Add proper error handling and retry logic to prevent
concurrent requests from causing data inconsistency
```

```
docs(readme): update installation instructions

Add missing dependency requirements and clarify
setup steps for new contributors
```

## Troubleshooting

### No Staged Changes

If the button doesn't appear or generation fails, ensure you have staged changes:

```bash
git add <files>
# or stage all changes
git add .
```

### Poor Message Quality

If generated messages aren't helpful:

- Review your staging strategy - don't stage unrelated changes together
- Add custom instructions in AGENTS.md for your project's conventions
- Try a different AI model through API configuration

### Integration Issues

The feature integrates with VS Code's built-in git functionality. If you encounter issues:

- Ensure your repository is properly initialized
- Check that VS Code can access your git repository
- Verify git is installed and accessible from VS Code

## Related Features

- [API Configuration Profiles](/docs/ai-providers) - Use different models for commit generation
- [Settings Management](/docs/getting-started/settings) - Manage all your Kilo Code preferences
