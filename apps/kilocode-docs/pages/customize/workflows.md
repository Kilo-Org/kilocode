---
title: "Workflows"
description: "Create automated workflows with Kilo Code"
---

# Workflows

Workflows automate repetitive tasks by defining step-by-step instructions for Kilo Code to execute. Invoke any workflow by typing `/[workflow-name.md]` in the chat.

{% image src="/docs/img/slash-commands/workflows.png" alt="Workflows tab in Kilo Code" width="600" caption="Workflows tab in Kilo Code" /%}

## Creating Workflows

Workflows are markdown files stored in `.kilocode/workflows/`:

- **Global workflows**: `~/.kilocode/workflows/` (available in all projects)
- **Project workflows**: `[project]/.kilocode/workflows/` (project-specific)

### Basic Setup

1. Create a `.md` file with step-by-step instructions
2. Save it in your workflows directory
3. Type `/filename.md` to execute

### Workflow Capabilities

Workflows can leverage:

- [Built-in tools](/docs/features/tools/tool-use-overview): [`read_file()`](/docs/features/tools/read-file), [`search_files()`](/docs/features/tools/search-files), [`execute_command()`](/docs/features/tools/execute-command)
- CLI tools: `gh`, `docker`, `npm`, custom scripts
- [MCP integrations](/docs/features/mcp/overview): Slack, databases, APIs
- [Mode switching](/docs/basic-usage/using-modes): [`new_task()`](/docs/features/tools/new-task) for specialized contexts

## Common Workflow Patterns

**Release Management**

```markdown
1. Gather merged PRs since last release
2. Generate changelog from commit messages
3. Update version numbers
4. Create release branch and tag
5. Deploy to staging environment
```

**Project Setup**

```markdown
1. Clone repository template
2. Install dependencies (`npm install`, `pip install -r requirements.txt`)
3. Configure environment files
4. Initialize database/services
5. Run initial tests
```

**Code Review Preparation**

```markdown
1. Search for TODO comments and debug statements
2. Run linting and formatting
3. Execute test suite
4. Generate PR description from recent commits
```

## Example: PR Submission Workflow

Let's walk through creating a workflow for submitting a pull request. This workflow handles the entire process from code review to deployment notification.

Create a file called `submit-pr.md` in your `.kilocode/workflows` directory:

```markdown
# Submit PR Workflow

You are helping submit a pull request. Follow these steps:

1. First, use `search_files` to check for any TODO comments or console.log statements that shouldn't be committed
2. Run tests using `execute_command` with `npm test` or the appropriate test command
3. If tests pass, stage and commit changes with a descriptive commit message
4. Push the branch and create a pull request using `gh pr create`
5. Use `ask_followup_question` to get the PR title and description from the user

Parameters needed (ask if not provided):

- Branch name
- Reviewers to assign
```

Now you can trigger this workflow by typing `/submit-pr.md` in the chat. Kilo Code will:

- Scan your code for common issues before committing
- Run your test suite to catch problems early
- Handle the Git operations and PR creation
- Notify your team automatically
- Set up follow-up tasks for deployment

This saves you from manually running the same 7-step process every time you want to submit code for review.
