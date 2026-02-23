# Contributing to Kilo CLI

See [the Documentation for details on contributing](https://kilo.ai/docs/contributing).

## TL;DR

There are lots of ways to contribute to the project:

- **Code Contributions:** Implement new features or fix bugs
- **Documentation:** Improve existing docs or create new guides
- **Bug Reports:** Report issues you encounter
- **Feature Requests:** Suggest new features or improvements
- **Community Support:** Help other users in the community

The Kilo Community is [on Discord](https://kilo.ai/discord).

## Opening Issues

**Blank issues are disabled.** You must use one of the provided templates:

- **Bug Report** — for reporting bugs and unexpected behavior
- **Feature Request** — for suggesting new features or enhancements
- **Question** — for asking questions

### ⚠️ Important: Using `gh` CLI or API (bypassing the web UI)

When you create issues via `gh issue create`, the GitHub API, or any tool that bypasses the web UI, **the issue templates are not automatically applied**. You must manually include all required fields in your issue body.

An AI compliance bot checks every new issue. If required fields are missing or contain only placeholder text, the bot will:

1. Add the `needs:compliance` label
2. Post a warning comment
3. **Auto-close the issue after 2 hours**

To avoid auto-closure, use the exact commands below.

#### Bug Report via `gh` CLI

```bash
gh issue create \
  --title "Brief description of the bug" \
  --label "bug" \
  --body "## Description
[Required: Describe the bug clearly — what happened and what you expected]

## Steps to Reproduce
1.
2.
3.

## Kilo Version
[e.g., 1.2.3]

## Operating System
[e.g., macOS 14.0, Ubuntu 22.04, Windows 11]

## Terminal
[e.g., iTerm2, Ghostty, Windows Terminal]"
```

#### Feature Request via `gh` CLI

```bash
gh issue create \
  --title "[FEATURE]: Brief description of the feature" \
  --label "discussion" \
  --body "## Verification
- [x] I have verified this feature I'm about to request hasn't been suggested before.

## Description
[Required: Describe the feature you want. What do you want to change or add? What are the benefits?]"
```

#### Question via `gh` CLI

```bash
gh issue create \
  --title "Brief description of your question" \
  --label "question" \
  --body "## Question
[Required: What's your question?]"
```

### Compliance Rules

The AI compliance bot enforces the following on every new issue:

- The issue must use a template (not a blank issue)
- Required fields must contain real content — not placeholder text like `[describe here]`
- Bug reports should include reproduction context (steps to reproduce are strongly recommended even though technically optional in the template)
- Feature requests must explain the problem or need being addressed
- Avoid AI-generated walls of text — be concise and specific

## Reporting Bugs

Use the **Bug Report** template when filing a bug. Required field:

- **Description** — clearly describe what happened and what you expected

Strongly recommended fields (the compliance bot checks for reproduction context):

- **Steps to Reproduce** — numbered steps to reliably reproduce the issue
- **Kilo Version** — run `kilo --version` to find this
- **Operating System** — e.g., macOS 14.0, Ubuntu 22.04, Windows 11
- **Terminal** — e.g., iTerm2, Ghostty, Windows Terminal

**Note:** The compliance bot checks that your description contains real content. Issues with placeholder text or no reproduction context may be flagged and auto-closed after 2 hours.

## Requesting Features

Use the **Feature Request** template when suggesting a new feature or enhancement.

Required fields:

- **Verification checkbox** — you must check "I have verified this feature I'm about to request hasn't been suggested before." Search existing issues before filing.
- **Description** — explain what you want to change or add, and why it would be beneficial.

**Title format:** Feature request titles must start with `[FEATURE]:` — e.g., `[FEATURE]: Add support for custom themes`.

**Note:** The compliance bot checks that your feature request explains the problem or need. Issues that don't meet this bar may be auto-closed after 2 hours.

## Issue First Policy

All pull requests must reference an existing issue. Before opening a PR:

1. Search for an existing issue describing the problem or feature
2. If none exists, create one using the appropriate template (see [Opening Issues](#opening-issues))
3. Wait for maintainer acknowledgment before investing significant effort
4. Reference the issue in your PR with `Fixes #N` or `Closes #N`

**Exceptions:** PRs with `docs:` or `refactor:` prefixes are exempt from this requirement.

This policy ensures changes are discussed and aligned with project direction before implementation work begins.

## Stale Issues and PRs

To keep the issue tracker manageable:

- **Issues** go stale after **90 days** of inactivity and are closed after **97 days** total (7 days after the stale warning)
- **Pull Requests** are closed after **60 days** of inactivity

To prevent an issue or PR from going stale, leave a comment with an update. If you believe a stale issue is still relevant, comment to reopen the discussion.

## Developing Kilo CLI

- **Requirements:** Bun 1.3+
- Install dependencies and start the dev server from the repo root:

  ```bash
  bun install
  bun dev
  ```

### Running against a different directory

By default, `bun dev` runs Kilo CLI in the `packages/kilo-cli` directory. To run it against a different directory or repository:

```bash
bun dev <directory>
```

To run Kilo CLI in the root of the repo itself:

```bash
bun dev .
```

### Building a "local" binary

To compile a standalone executable:

```bash
./packages/kilo-cli/script/build.ts --single
```

Then run it with:

```bash
./packages/kilo-cli/dist/kilo-cli-<platform>/bin/kilo
```

Replace `<platform>` with your platform (e.g., `darwin-arm64`, `linux-x64`).

### Understanding bun dev vs kilo

During development, `bun dev` is the local equivalent of the built `kilo` command. Both run the same CLI interface:

```bash
# Development (from project root)
bun dev --help           # Show all available commands
bun dev serve            # Start headless API server
bun dev web              # Start server + open web interface

# Production
kilo --help          # Show all available commands
kilo serve           # Start headless API server
kilo web             # Start server + open web interface
```

### Pull Request Expectations

- **Issue First Policy:** All PRs must reference an existing issue (see [Issue First Policy](#issue-first-policy)).
- **UI Changes:** Include screenshots or videos (before/after).
- **Logic Changes:** Explain how you verified it works.
- **PR Titles:** Follow conventional commit standards (see [PR Titles](#pr-titles)).

## PR Titles

PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/) format:

| Prefix      | When to use                                |
| ----------- | ------------------------------------------ |
| `feat:`     | New feature                                |
| `fix:`      | Bug fix                                    |
| `docs:`     | Documentation changes only                 |
| `chore:`    | Maintenance, dependency updates, tooling   |
| `refactor:` | Code restructuring without behavior change |
| `test:`     | Adding or updating tests                   |

Examples:

- `feat: add support for custom themes`
- `fix: resolve crash when config file is missing`
- `docs: update installation instructions`

PRs with non-conforming titles will be flagged by the PR standards bot.

### Issue and PR Lifecycle

To keep our backlog manageable, we automatically close inactive issues and PRs after a period of inactivity. This isn't a judgment on quality — older items tend to lose context over time and we'd rather start fresh if they're still relevant. Feel free to reopen or create a new issue/PR if you're still working on something!

### Style Preferences

- **Functions:** Keep logic within a single function unless breaking it out adds clear reuse.
- **Destructuring:** Avoid unnecessary destructuring.
- **Control flow:** Avoid `else` statements; prefer early returns.
- **Types:** Avoid `any`.
- **Variables:** Prefer `const`.
- **Naming:** Concise single-word identifiers when descriptive.
- **Runtime APIs:** Use Bun helpers (e.g., `Bun.file()`).
