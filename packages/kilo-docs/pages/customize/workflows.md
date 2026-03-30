---
title: "Workflows"
description: "Create automated workflows with Kilo Code"
---

# Workflows

Workflows (also called **slash commands** in the new extension) automate repetitive tasks by defining step-by-step instructions for Kilo Code to execute.

{% image src="/docs/img/slash-commands/workflows.png" alt="Workflows tab in Kilo Code" width="600" caption="Workflows tab in Kilo Code" /%}

## Creating Workflows

{% tabs %}
{% tab label="VSCode" %}

Workflows are Markdown files stored as **slash commands** in `.kilo/commands/`:

- **Global commands**: `~/.config/kilo/commands/` (available in all projects)
- **Project commands**: `[project]/.kilo/commands/` (project-specific)

### Basic Setup

1. Create a `.md` file with step-by-step instructions
2. Save it in your commands directory
3. Type `/command-name` in the chat (just the filename without `.md` extension) to execute

For example, a file at `.kilo/commands/submit-pr.md` is invoked with `/submit-pr`.

### Optional Frontmatter

Command files can include YAML frontmatter:

```markdown
---
description: Submit a pull request with checks
agent: code
---

You are helping submit a pull request...
```

| Field         | Description                                   |
| ------------- | --------------------------------------------- |
| `description` | Shown in the command picker                   |
| `agent`       | Which agent to use when invoking this command |
| `model`       | Model override for this command               |
| `subtask`     | When `true`, runs as a sub-agent session      |

### Workflow Capabilities

Workflows can leverage all built-in tools: `read`, `glob`, `grep`, `edit`, `write`, `bash`, `webfetch`, and MCP server tools.

### Migration from Legacy Workflows

The new extension automatically migrates legacy workflows from `.kilocode/workflows/` to the new command format on startup. You can also manually move files and remove the `.md` extension from invocations.

{% /tab %}
{% tab label="VSCode (Legacy)" %}

Workflows are markdown files stored in `.kilocode/workflows/`:

- **Global workflows**: `~/.kilocode/workflows/` (available in all projects)
- **Project workflows**: `[project]/.kilocode/workflows/` (project-specific)

### Basic Setup

1. Create a `.md` file with step-by-step instructions
2. Save it in your workflows directory
3. Type `/filename.md` to execute

### Workflow Capabilities

Workflows can leverage:

- [Built-in tools](/docs/automate/tools): [`read_file()`](/docs/automate/tools/read-file), [`search_files()`](/docs/automate/tools/search-files), [`execute_command()`](/docs/automate/tools/execute-command)
- CLI tools: `gh`, `docker`, `npm`, custom scripts
- [MCP integrations](/docs/automate/mcp/overview): Slack, databases, APIs
- [Agent switching](/docs/code-with-ai/agents/using-agents): [`new_task()`](/docs/automate/tools/new-task) for specialized contexts

{% /tab %}
{% /tabs %}

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

Let's walk through creating a workflow for submitting a pull request.

{% tabs %}
{% tab label="VSCode" %}

Create a file called `submit-pr.md` in your `.kilo/commands` directory:

```markdown
---
description: Submit a pull request with full checks
---

# Submit PR Workflow

You are helping submit a pull request. Follow these steps:

1. First, use `grep` to check for any TODO comments or console.log statements that shouldn't be committed
2. Run tests using `bash` with `npm test` or the appropriate test command
3. If tests pass, stage and commit changes with a descriptive commit message
4. Push the branch and create a pull request using `bash` with `gh pr create`
5. Use `question` to get the PR title and description from the user

Parameters needed (ask if not provided):

- Branch name
- Reviewers to assign
```

Trigger this workflow by typing `/submit-pr` in the chat.

{% /tab %}
{% tab label="VSCode (Legacy)" %}

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

Trigger this workflow by typing `/submit-pr.md` in the chat.

{% /tab %}
{% /tabs %}

Kilo Code will:

- Scan your code for common issues before committing
- Run your test suite to catch problems early
- Handle the Git operations and PR creation
- Set up follow-up tasks for deployment

This saves you from manually running the same steps every time you want to submit code for review.
