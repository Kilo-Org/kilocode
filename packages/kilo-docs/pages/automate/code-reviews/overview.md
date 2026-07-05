---
title: "Code Reviews"
description: "Automate code reviews with AI assistance"
---

# Code Reviews

Kilo's **Code Reviews** feature automatically analyzes your pull or merge requests using an AI model of your choice. It can review code the moment a PR/MR is opened or updated, surface issues, and provide structured feedback across performance, security, style, and test coverage.

## What Code Reviews Enable

- Automated AI review on every pull request
- Consistent feedback based on your team’s standards
- Automatic detection of bugs, security risks, and anti-patterns
- Deep reasoning over changed files, diffs, and repo context
- Customizable review strictness and focus areas
- Repository-owned review guidance through `REVIEW.md`, including sub-agent usage

## Supported Platforms

| Platform | Integration Type | Details |
|---|---|---|
| GitHub | GitHub App | [GitHub Setup Guide](./github) |
| GitLab | OAuth or PAT | [GitLab Setup Guide](./gitlab) |

## Prerequisites

Before enabling Code Reviews:

- **A platform integration must be configured:** Connect your GitHub or GitLab account via the [Integrations page](https://app.kilo.ai/integrations) so that the Review Agent can access your repositories. See the [Integration setup guide](/docs/automate/integrations) for detailed instructions.
- **Kilo Code credits:** The AI model uses credits when analyzing your code.

## Cost

- **Compute and review time are free during limited beta**
  - Feedback is welcome in the Code Reviews beta Discord channel:
    - [Kilo Discord](https://discord.gg/hZnd57qN)
- **Kilo Code credits are still used** when the agent performs model reasoning during a review.

## Getting Started

1. Go to the **Code Reviews** page in your [personal dashboard](https://app.kilo.ai/profile) or [organization dashboard](https://app.kilo.ai/organizations).
2. Toggle **Enable AI Code Review** to on.
3. Choose an **AI Model** (e.g., Claude Sonnet 4.5).
4. Select a **Review Style** — Strict, Balanced, or Lenient.
5. Choose which **repositories** should receive automatic reviews.
6. Optionally select **Focus Areas** such as security, performance, bugs, style, testing, or documentation.
7. Set a **maximum review time** (5–30 minutes).
8. Optionally enable **Use REVIEW.md** and add a `REVIEW.md` file at the repository root to shape how the agent reviews your code.

Once configured, the Review Agent runs automatically on PR/MR events. For platform-specific setup, see:

- [GitHub Code Reviews](./github)
- [GitLab Code Reviews](./gitlab)

## Repository Guidance with REVIEW.md

Use `REVIEW.md` when review policy should live with the repository instead of only in the Kilo dashboard. This is the best place to document domain-specific rules, severity calibration, files to skip, verification expectations, summary style, and how Kilo should use sub-agents.

To use it:

1. Create `REVIEW.md` at the repository root.
2. Commit it to the base branch used by pull requests or merge requests.
3. Open Code Reviews settings in the [Kilo web app](https://app.kilo.ai/code-reviews) and enable **Use REVIEW.md**.
4. Save the configuration and run a review.

Kilo reads `REVIEW.md` from the PR/MR base branch, not the feature branch. That prevents an unreviewed change from rewriting the review policy used to evaluate itself. If the file is disabled, missing, empty, or unreadable, Kilo falls back to built-in guidance. If it is longer than 10,000 characters, Kilo truncates it and notes that in the review summary footer.

### Default Sub-Agent Usage

By default, Code Reviews uses sub-agents only when they materially improve coverage. After reading the diff, the reviewer estimates changed file count and changed lines, then chooses the largest tier triggered by either signal.

| Diff size | Default behavior | Why |
|---|---|---|
| Tiny: up to 2 files and under 100 changed lines | Use 0 sub-agents and review directly | The coordination cost is higher than the coverage benefit for very small changes. |
| Small: 3-5 files or 100-300 changed lines | Use at most 1 sub-agent for a distinct risky area | One focused second pass can help without creating duplicate or low-signal findings. |
| Medium and larger: 6+ files or more than 300 changed lines | Use the full 6 sub-agents, sharded by independent areas | Larger diffs benefit from parallel coverage across files, domains, and risk categories. |

The reviewer does not spawn sub-agents for a single-file or straightforward typo/config change. Sub-agents are read-only and do not post comments themselves. They return findings with path, line, severity, and rationale. The main reviewer remains responsible for verifying findings, removing duplicates, checking that inline comments target valid diff lines, and posting the final comments and summary.

#### Changing Sub-Agent Behavior

`REVIEW.md` can replace the default sub-agent guidance. Use it to change both how many sub-agents Kilo should use and what each one should inspect.

Good sub-agent guidance is explicit about:

- When to use 0 sub-agents.
- When to use 1-2 targeted sub-agents.
- When to use the full 6 sub-agents.
- Which areas each sub-agent should own.
- What each sub-agent should return to the main reviewer.
- Which hard constraints still matter, such as read-only review and no direct commenting by sub-agents.

Example `REVIEW.md` section:

```markdown
## Sub-agent usage

Use 0 sub-agents for docs-only, formatting-only, dependency-lockfile-only, or single-file typo changes.

Use 1 sub-agent for focused changes under 300 changed lines when the diff touches one risky area, such as authentication, billing, database migrations, or security-sensitive parsing.

Use 3 sub-agents when a PR spans API, data model, and UI changes:

1. API/data reviewer: check request validation, authorization, persistence, and migration safety.
2. UI reviewer: check user-visible behavior, accessibility, empty states, and error states.
3. Test reviewer: check that tests cover the observable behavior and important edge cases.

Use the full 6 sub-agents only for large cross-cutting changes, security-sensitive work, or changes above 800 changed lines. Split them by independent domains rather than asking every sub-agent to review the same files.

Each sub-agent must stay read-only, must not post comments, and must return findings with path, line, severity, rationale, and confidence. The main reviewer must verify every finding before posting it.
```

`REVIEW.md` can change review policy and sub-agent usage, but it cannot override Kilo's hard safety constraints, read-only mode, non-interactive execution, platform API instructions, diff-line rules, duplicate-comment rules, or output formatting requirements.

## Local Code Reviews

Code Reviewer is also available locally. This is valuable for developers who want to review their code before pushing a pull request to their team publicly, or for developers who want reviews and don't need to ship a pull request to GitHub.

{% tabs %}
{% tab label="VSCode" %}

Use `/review` for all local code reviews:

- **`/review`** — Review uncommitted changes (staged, unstaged, and untracked) when run without arguments
- **`/review uncommitted [guidance]`** — Review uncommitted changes with optional guidance
- **`/review branch [base] [guidance]`** — Review your current branch vs. its detected or specified base, with optional guidance
- **`/review <commit-hash>`** — Review a specific commit
- **`/review <PR URL or number>`** — Review a pull request

{% /tab %}
{% tab label="CLI" %}

Use `/review` for all local code reviews:

- **`/review`** — Review uncommitted changes (staged, unstaged, and untracked) when run without arguments
- **`/review uncommitted [guidance]`** — Review uncommitted changes with optional guidance
- **`/review branch [base] [guidance]`** — Review your current branch vs. its detected or specified base, with optional guidance
- **`/review <commit-hash>`** — Review a specific commit
- **`/review <PR URL or number>`** — Review a pull request

{% /tab %}
{% /tabs %}

## How Code Reviews Work

When a pull request or merge request is opened or updated:

1. The Review Agent receives the PR/MR metadata, diff, and file context.
2. The selected model analyzes all changes.
3. The agent applies your chosen review style and focus areas.
4. It generates a structured review with:
   - Inline comments
   - Summary findings
   - Suggested fixes
   - Risk and severity tagging
5. Reviews respect the **maximum time limit** you set.
6. Only repositories you’ve selected will trigger automatic analysis.

Reviews are posted directly in your platform (GitHub or GitLab) as if coming from a team reviewer.

## Review Styles

### Strict

- Flags all potential issues
- Emphasizes correctness, quality, and security
- Useful for mission-critical code paths or production services

### Balanced

- Most popular option
- Prioritizes clarity and practicality
- Surfaces important issues without overwhelming noise

### Lenient

- Flags only critical issues
- Encouraging and lightweight
- Ideal for exploratory PRs/MRs, prototypes, or early WIP reviews

## Focus Areas

You can tailor what the Review Agent pays attention to:

### Security Vulnerabilities

- SQL injection
- XSS
- Unsafe APIs
- Secrets and credential exposure

### Performance Issues

- N+1 queries
- Inefficient loops
- High-complexity functions

### Bug Detection

- Logic errors
- Edge-case failures
- Incorrect assumptions

### Code Style

- Formatting
- Naming conventions
- Readability improvements

### Test Coverage

- Missing or inadequate tests
- Uncovered logic paths

### Documentation

- Missing comments
- Unclear APIs

## Perfect For

The Review Agent is ideal for:

- **Teams wanting consistent, real-time PR reviews**
- **Small teams without dedicated reviewers**
- **Large repos where issues are easy to miss**
- **High-velocity engineering orgs shipping many daily PRs**
- **Security-focused environments requiring strict gates**
- **Educating junior developers with rich explanations**

## Limitations and Guidance

- Reviews can run for **up to 30 minutes** depending on your setting.
- The agent reviews **only the changed files**, not the entire repository.
- Some highly dynamic or domain-specific code may require additional context in `REVIEW.md`.
- The agent will only run on **selected repositories**.
- During beta, review capacity may be throttled for extremely large PRs.
