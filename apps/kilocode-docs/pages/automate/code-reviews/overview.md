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

## Supported Platforms

| Platform | Integration Type | Details                        |
| -------- | ---------------- | ------------------------------ |
| GitHub   | GitHub App       | [GitHub Setup Guide](./github) |
| GitLab   | OAuth or PAT     | [GitLab Setup Guide](./gitlab) |

## Prerequisites

Before enabling Code Reviews:

- **A platform integration must be configured:** Connect your GitHub or GitLab account via the [Integrations page](https://app.kilo.ai/integrations) so that the Review Agent can access your repositories.
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
8. Add **custom instructions** to shape how the agent reviews your code.

Once configured, the Review Agent runs automatically on PR/MR events. For platform-specific setup, see:

- [GitHub Code Reviews](./github.md)
- [GitLab Code Reviews](./gitlab.md)

## Local Code Reviews

Code Reviewer is also available locally. This is valuable for developers who want to review their code before pushing a pull request to their team publicly, or for developers who want reviews and don't need to ship a pull request to GitHub.

### VS Code

Select 'Review' from the mode dropdown after making local changes, and click 'Send' for AI-powered feedback and suggestions.

![VS Code interface showing Review option in mode dropdown](/docs/img/code-reviewer/review-mode.png "Review Mode")

### CLI

The CLI provides two commands for local code reviews:

- **`/local-review`** — Review all changes on your current branch vs the base branch
- **`/local-review-uncommitted`** — Review uncommitted changes (staged + unstaged)

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
- Some highly dynamic or domain-specific code may require additional context in custom instructions.
- The agent will only run on **selected repositories**.
- During beta, review capacity may be throttled for extremely large PRs.
