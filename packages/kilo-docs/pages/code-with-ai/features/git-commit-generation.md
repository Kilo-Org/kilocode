---
title: "Git Commit Generation"
description: "Automatically generate meaningful git commit messages"
---

# Generate Commit Messages

Generate descriptive commit messages automatically from your git changes. Kilo Code analyzes your files and creates conventional commit messages that follow best practices.

{% callout type="info" %}
Kilo Code analyzes your **staged changes** first. If nothing is staged, it falls back to your **unstaged and untracked changes**, so you can generate a message without staging files first. Untracked files are represented by their path.
{% /callout %}

## How It Works

The git commit message generator:

- Analyzes your **staged changes** first, then falls back to unstaged and untracked changes when nothing is staged
- Ignores lock files (such as `package-lock.json`, `Cargo.lock`, and `poetry.lock`) at any depth
- Uses AI to understand the context and purpose of your changes
- Creates descriptive commit messages that explain what was changed and why following the [Conventional Commits](https://www.conventionalcommits.org/) (by default, customizable)

## Using the Feature

### Generating a Commit Message

1. Optionally stage your changes using `git add` or the VS Code git interface. Kilo Code uses staged changes first, then unstaged and untracked changes.
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

The extension provides the same **SCM button** in the VS Code Source Control panel. Clicking it generates a commit message using the CLI backend's commit message generation API.

Configuration is handled through the extension's settings or the shared `kilo.jsonc` config file.

Customize the commit prompt from **Settings > Commit Message**. Kilo saves this prompt to the current project's config so each repository can follow its own commit conventions without changing your global settings.

You can also set it directly in the project config:

```json
{
  "commit_message": {
    "prompt": "Write concise conventional commits with the package scope when possible."
  }
}
```

### Commit message language

Generated messages follow your Kilo Code interface language by default. To use a different language for commit messages than the rest of the UI, open **Settings > Commit Message** and pick a language, or set `kilo-code.new.languageCommitMessage` in VS Code settings. The default, `sync`, follows the extension's interface language; any other value uses that language for the generated message.

{% callout type="info" %}
Git commit message generation is a **VS Code extension feature**. It is not available in the CLI/TUI.
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

### Custom Templates

- Tailor the prompt template to your project's needs
- Include project-specific terminology or conventions
- Add instructions for handling specific types of changes

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

### No Changes to Describe

If generation fails with "No changes found to generate a commit message for", the repository has no staged, unstaged, or untracked changes. Make an edit or stage files, then try again:

```bash
git add <files>
# or stage all changes
git add .
```

### Poor Message Quality

If generated messages aren't helpful:

- Review your staging strategy - don't stage unrelated changes together
- Customize the prompt template with more specific instructions
- Try a different AI model through API configuration

### Integration Issues

The feature integrates with VS Code's built-in git functionality. If you encounter issues:

- Ensure your repository is properly initialized
- Check that VS Code can access your git repository
- Verify git is installed and accessible from VS Code

## Related Features

- [API Configuration Profiles](/docs/ai-providers) - Use different models for commit generation
- [Settings Management](/docs/getting-started/settings) - Manage all your Kilo Code preferences
