# /init Pre-Commit Secret Check

**Priority:** P2
**Status:** 🔨 Partial (assigned)
**Issue:** [#6077](https://github.com/Kilo-Org/kilocode/issues/6077)

## Problem

The `/init` command sets up a project for agentic engineering. As a security best practice, it should check whether the repository has a pre-commit secret scanning hook configured (e.g., `detect-secrets`, `gitleaks`, or `pre-commit` framework hooks). If not, it should suggest adding one.

## Remaining Work

- In the CLI's `/init` command implementation (`packages/opencode/`), after writing AGENTS.md and other init files, check if the repository has:
  - A `.pre-commit-config.yaml` with a secret scanning hook
  - A `.git/hooks/pre-commit` file
  - A `detect-secrets` baseline file (`.secrets.baseline`)
- If none are found, output a recommendation to the user with a brief explanation and a link to getting started with `detect-secrets` or `gitleaks`
- Optionally: offer to install `detect-secrets` as part of the init flow (with user confirmation)

## Implementation Notes

- This is a CLI-side change in `packages/opencode/src/`
- The extension surfaces the `/init` command through the chat interface; the output will appear as agent output in the chat
- The check should be informational (a warning/suggestion), not a hard failure that blocks init
