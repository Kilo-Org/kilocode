---
title: "Contributing"
description: "Contribute to Kilo Code"
---

# Contributing Overview

{% callout type="info" %}
**New versions of the VS Code extension and CLI are being developed in [Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode)** (extension at `packages/kilo-vscode`, CLI at `packages/opencode`). If you're looking to contribute to the extension or CLI, please head over to that repository.
{% /callout %}

Kilo Code is an open-source project that welcomes contributions from developers of all skill levels. This guide will help you get started with contributing to Kilo Code, whether you're fixing bugs, adding features, improving documentation, or sharing custom modes.

## Ways to Contribute

There are many ways to contribute to Kilo Code:

1. **Code Contributions**: Implement new features or fix bugs
2. **Documentation**: Improve existing docs or create new guides
3. **Marketplace Contributions**: Create and share custom modes, skills, and MCP servers via the [Kilo Marketplace](https://github.com/Kilo-Org/kilo-marketplace)
4. **Bug Reports**: Report issues you encounter
5. **Feature Requests**: Suggest new features or improvements
6. **Community Support**: Help other users in the community

## Setting Up the Development Environment

Setting Up the Development Environment is described in details on the [Development Environment](/docs/contributing/development-environment) page.

## Understanding the Architecture

Before diving into the code, we recommend reviewing the [Architecture Overview](/docs/contributing/architecture) to understand how the different components of Kilo Code fit together.

## Development Workflow

### Branching Strategy

- Create a new branch for each feature or bugfix
- Use descriptive branch names (e.g., `feature/new-tool-support` or `fix/browser-action-bug`)
- **For documentation only changes**: Use the `docs/` prefix (e.g., `docs/improve-mcp-guide`)

```bash
git checkout -b your-branch-name

# For documentation changes:
git checkout -b docs/your-change-description
```

### Coding Standards

- Follow the existing code style and patterns
- Use TypeScript for new code
- Include appropriate tests for new features
- Update documentation for any user-facing changes

### Contribution Ownership and AI Assistance

AI and coding agents are welcome in Kilo contributions. Contributors still own the work they submit: you must personally understand the change, test it appropriately, be able to explain the diff, and understand how it interacts with the affected package and the rest of the repo.

When using an agent, start it from the repository root so the root `AGENTS.md` is available. If you work in a package with its own guidance, check and follow the package-specific `AGENTS.md` or contributor docs too.

Maintainers may close PRs that appear to be submitted without credible contributor ownership or understanding, including AI-assisted work that has not been meaningfully reviewed by the contributor.

### Commit Guidelines

- Write clear, concise commit messages
- Reference issue numbers when applicable
- Keep commits focused on a single change

### Changesets

User-facing changes (features, fixes, breaking changes) require a changeset file so the update shows up in the next release notes. Run the interactive tool, or create the file by hand:

```bash
bunx changeset add
```

Or create `.changeset/<slug>.md` manually:

```md
---
"kilo-code": minor
---

Short description of the change for the changelog.
```

Guidelines:

- Use `patch` for bug fixes, `minor` for new features, `major` for breaking changes.
- Descriptions are read by end users in release notes — keep them concise and feature-oriented. Describe **what changed from the user's perspective**, not implementation details.
- Write in imperative mood (e.g. "Support exporting conversations as markdown" rather than "Add a new export handler that serializes session messages to .md files").
- Changesets are consumed at release time by the `publish.yml` workflow, which generates changelog entries for the GitHub release notes.

Skip the changeset only for internal refactors, CI tweaks, test-only changes, or docs that do not affect users.

### Other Guardrails

- Regenerate `packages/sdk/js/` with `./script/generate.ts` after changing server endpoints.
- Run `bun run script/extract-source-links.ts` after adding or changing guarded URLs in `packages/kilo-vscode/`, `packages/kilo-vscode/webview-ui/`, or `packages/opencode/src/`.
- When editing shared `packages/opencode/` files, keep Kilo changes small and mark Kilo-only edits with `// kilocode_change` for a single line or `// kilocode_change start` / `// kilocode_change end` for a block. Do not add these markers inside `kilocode`-named paths.

### Testing Your Changes

Use the current Bun commands in the [Development Environment](/docs/contributing/development-environment) guide for repo-level, CLI, backend/API, VS Code extension, and docs checks.

Key reminders:

- Do **not** run `bun test` from the repo root. The root test script intentionally exits with failure so tests run from the package that owns them.
- Use the root [TESTING.md](https://github.com/Kilo-Org/kilocode/blob/main/TESTING.md) guide for backend/API validation with `bun dev serve` and `curl`-based requests.
- Regenerate the SDK with `./script/generate.ts` from the repo root after changing server endpoints.
- Manually verify extension behavior with `bun run extension`.
- For manual documentation validation, preview the affected page and check changed links and rendered content.

Before marking a PR ready for review, include testing evidence in the PR template. See [Testing Evidence for Pull Requests](/docs/contributing/development-environment#testing-evidence-for-pull-requests) for the full standard, including docs/config-only verification and blocked command fallback requirements.

### Creating a Pull Request

Contributor guidance exists to protect maintainer review time and keep reviews focused on work that is ready to evaluate.

Follow the issue-first policy by linking the relevant issue when you open a PR. Use `Fixes #123`, `Closes #123`, or equivalent linked issue wording so reviewers can see the problem statement, discussion, and intended scope before reviewing the code change.

1. Push your changes to your fork:

   ```bash
   git push origin your-branch-name
   ```

2. Go to the [Kilo Code repository](https://github.com/Kilo-Org/kilocode)

3. Click "New Pull Request" and select "compare across forks"

4. Select your fork and branch

5. Fill out the PR template with:
   - Related issue link, or an explanation for why there is no existing issue
   - What problem is being solved and why the change is needed
   - Important implementation choices or tradeoffs reviewers cannot infer from the diff
   - Testing evidence, including commands run and results
   - Manual/local verification performed
   - Any command blocker plus substitute verification
   - Screenshots or video for visual UI changes, showing the relevant before/after or resulting state
   - Confirmation that you personally reviewed the diff and can explain the changes, including any AI-assisted work

Keep the description focused on context reviewers cannot infer from the diff. Skip file-by-file summaries, placeholders, and other filler.

Maintainers may close or decline review of PRs presented as review-ready at their discretion when they lack linked issue context, a clear what/why explanation, credible testing evidence, credible contributor ownership of AI-assisted work, or relevant UI proof for visual UI changes.

When a PR is close to this bar, addresses important work, or would benefit from further shaping, maintainers may ask for specific fixes instead of closing or declining review. Contributors may reopen or resubmit once the PR meets the documented bar.

## Tracker Use and Automation

Please keep the issue and PR trackers useful for maintainers and contributors. Do not submit batches of agent-generated, untested, or weakly reviewed PRs.

Keep concurrent PRs focused and limited. As a rule, open no more than three PRs at a time, especially if you are a new contributor. Prioritize high-impact or high-priority issues first instead of opening many speculative fixes. If a contributor opens a large batch of low-value or duplicative PRs, maintainers may close the batch and ask the contributor to choose one PR to reopen, focus, and bring up to the documented review bar before submitting more.

For issues, do not mass-create tickets through automation or agents. Search existing issues first, open issues only when you have enough context for someone to act, and prioritize the most important reports instead of filing every possible finding. Maintainers may close duplicate, low-signal, automated, or weakly reviewed issues without action.

Maintainers may close issues or PRs that disregard the contribution guide, bypass required context, or lack credible contributor ownership of AI-assisted work. Repeated disregard of this contribution guide, or high-volume automated or agent-generated tracker spam across issues or PRs, may result in maintainers blocking the responsible account.

## Bug Bounties

Kilo has bug bounties. To be eligible, make sure your GitHub account is connected in your Kilo account.

## Contributing to the Kilo Marketplace

The [Kilo Marketplace](https://github.com/Kilo-Org/kilo-marketplace) is a community-driven repository of agent tooling that extends Kilo Code's capabilities. You can contribute:

- **Skills**: Modular workflows and domain expertise that teach agents how to perform specific tasks
- **MCP Servers**: Standardized integrations that connect agents to external tools and services
- **Modes**: Custom agent personalities and behaviors with tailored tool access

To contribute:

1. Follow the documentation for [Custom Modes](/docs/customize/custom-modes), [Skills](/docs/customize/skills), or [MCP Servers](/docs/automate/mcp/overview) to create your resource

2. Test your contribution thoroughly

3. Submit a pull request to the [Kilo Marketplace repository](https://github.com/Kilo-Org/kilo-marketplace)

## Engineering Specs

For larger features, we write engineering specs to align on requirements before implementation. Check the [Feature Proposals](/docs/contributing/features) section to see planned features and learn how to contribute specs.

## Documentation Contributions

Documentation improvements are highly valued contributions:

1. Follow the documentation style guide:
   - Use clear, concise language
   - Include examples where appropriate
   - Use absolute paths starting from `/docs/` for internal links (except within the same directory)
   - Don't include `.md` extensions in links

2. Test your documentation changes and run the docs site locally from the repo root:

   ```bash
   bun run --filter @kilocode/kilo-docs test
   bun run --filter @kilocode/kilo-docs build
   bun run --filter @kilocode/kilo-docs dev
   ```

   For manual validation, preview the affected page and check changed links and rendered content.

3. Submit a PR with your documentation changes

## Community Guidelines

When participating in the Kilo Code community:

- Be respectful and inclusive
- Provide constructive feedback
- Help newcomers get started
- Follow the [Code of Conduct](https://github.com/Kilo-Org/kilocode/blob/main/CODE_OF_CONDUCT.md)

## Getting Help

If you need help with your contribution:

- Join our [Discord community](https://kilo.ai/discord) for real-time support
- Ask questions on [GitHub Discussions](https://github.com/Kilo-Org/kilocode/discussions)
- Visit our [Reddit community](https://www.reddit.com/r/kilocode)

## Recognition

All contributors are valued members of the Kilo Code community. Contributors are recognized in:

- Release notes
- The project's README
- The contributors list on GitHub

Thank you for contributing to Kilo Code and helping make AI-powered coding assistance better for everyone!
