# CONTRIBUTING.md Sync Design

## Overview

This document describes the design for a synchronization mechanism that keeps
`CONTRIBUTING.md` up to date whenever the GitHub issue templates, compliance
workflows, or stale-policy workflows change.

---

## 1. Chosen Approach

**Hybrid: structured extraction + AI-assisted prose update, delivered as a PR.**

The repo already uses `kilo run` (AI agent) in `duplicate-issues.yml` and
`triage.yml`. The same pattern is used here: a GitHub Actions workflow detects
changes to the "source of truth" files, runs a TypeScript/Bun script to extract
structured facts (required fields, labels, timeouts, title patterns, etc.), then
calls `kilo run` to update the relevant sections of `CONTRIBUTING.md` and opens
a PR for human review.

### Why not pure validation (approach 2)?

A validation-only approach would fail CI whenever a template changes, forcing a
human to manually update `CONTRIBUTING.md` before the PR can merge. That creates
friction and is easy to forget. Automated generation is strictly better.

### Why not pure generation (approach 3)?

Pure deterministic generation would overwrite human-written prose (e.g., the
"Style Preferences" section, the "Developing Kilo CLI" section). AI-assisted
update preserves prose while refreshing only the data-driven sections.

### Why a PR instead of a direct push?

- Gives maintainers a chance to review the AI-generated diff.
- Consistent with the repo's existing `generate.yml` pattern (which pushes
  directly) but safer for documentation changes that affect contributor UX.
- If the diff is trivially correct, auto-merge can be enabled later.

---

## 2. Source-of-Truth Files

The following files trigger the sync workflow when changed on the `dev` branch:

| File                                         | What it controls in CONTRIBUTING.md           |
| -------------------------------------------- | --------------------------------------------- |
| `.github/ISSUE_TEMPLATE/bug-report.yml`      | Required/optional fields, labels              |
| `.github/ISSUE_TEMPLATE/feature-request.yml` | Required fields, default title prefix, labels |
| `.github/ISSUE_TEMPLATE/question.yml`        | Required fields, labels                       |
| `.github/ISSUE_TEMPLATE/config.yml`          | Blank issues enabled/disabled                 |
| `.github/workflows/duplicate-issues.yml`     | Compliance rules, auto-close window           |
| `.github/workflows/compliance-close.yml`     | Auto-close window (2 hours)                   |
| `.github/workflows/stale-issues.yml`         | Issue stale/close days                        |
| `.github/workflows/close-stale-prs.yml`      | PR stale close days                           |
| `.github/workflows/pr-standards.yml`         | PR title regex, linked-issue requirement      |

---

## 3. How the Sync Works — Step by Step

```
Push to dev branch
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  GitHub Actions: sync-contributing.yml                      │
│                                                             │
│  Trigger: paths-filter detects changes in source files      │
└─────────────────────────────────────────────────────────────┘
       │  (no changes → workflow exits early)
       ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Checkout repo (full history for PR creation)       │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 2: Setup Bun + Setup Kilo                             │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 3: Run extract-contributing-facts.ts                  │
│                                                             │
│  Reads all source-of-truth files and writes a JSON          │
│  "facts" file: contributing-facts.json                      │
│                                                             │
│  Facts extracted:                                           │
│  - Per-template: name, labels, required fields,             │
│    optional fields, default title                           │
│  - blank_issues_enabled from config.yml                     │
│  - compliance_window_hours from compliance-close.yml        │
│  - issue_stale_days, issue_close_days from stale-issues.yml │
│  - pr_stale_days from close-stale-prs.yml                   │
│  - pr_title_regex, skip_issue_check_prefixes,               │
│    conventional_commit_prefixes from pr-standards.yml       │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 4: kilo run — update CONTRIBUTING.md                  │
│                                                             │
│  Passes contributing-facts.json + CONTRIBUTING.md to the   │
│  AI agent with a precise prompt instructing it to update    │
│  only the data-driven sections (see Section 4 for prompt)   │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 5: Check for diff                                     │
│  If no changes → exit (CONTRIBUTING.md already up to date)  │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 6: Open PR via gh pr create                           │
│  Branch: docs/sync-contributing-<timestamp>                  │
│  Title: docs: sync CONTRIBUTING.md with templates/workflows │
│  Body: lists which source files changed + facts diff        │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. GitHub Actions Workflow (YAML)

```yaml
# .github/workflows/sync-contributing.yml
name: sync-contributing

on:
  push:
    branches:
      - dev
    paths:
      - .github/ISSUE_TEMPLATE/bug-report.yml
      - .github/ISSUE_TEMPLATE/feature-request.yml
      - .github/ISSUE_TEMPLATE/question.yml
      - .github/ISSUE_TEMPLATE/config.yml
      - .github/workflows/duplicate-issues.yml
      - .github/workflows/compliance-close.yml
      - .github/workflows/stale-issues.yml
      - .github/workflows/close-stale-prs.yml
      - .github/workflows/pr-standards.yml
  workflow_dispatch: {}

jobs:
  sync:
    runs-on: blacksmith-4vcpu-ubuntu-2404
    permissions:
      contents: write
      pull-requests: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Bun
        uses: ./.github/actions/setup-bun

      - name: Setup Kilo
        uses: ./.github/actions/setup-kilo

      - name: Setup Git Committer
        id: committer
        uses: ./.github/actions/setup-git-committer
        with:
          kilo-maintainer-app-id: ${{ secrets.KILO_MAINTAINER_APP_ID }}
          kilo-maintainer-app-secret: ${{ secrets.KILO_MAINTAINER_APP_SECRET }}

      - name: Extract contributing facts
        run: bun .github/scripts/extract-contributing-facts.ts

      - name: Update CONTRIBUTING.md via Kilo
        env:
          KILO_API_KEY: ${{ secrets.KILO_API_KEY }}
          KILO_ORG_ID: ${{ secrets.KILO_ORG_ID }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          KILO_PERMISSION: |
            {
              "write_file": { "CONTRIBUTING.md": "allow" },
              "bash": { "*": "deny" },
              "webfetch": "deny"
            }
        run: |
          FACTS=$(cat .github/scripts/contributing-facts.json)
          kilo run -m "kilo/anthropic/claude-sonnet-4-5" \
            "You are updating CONTRIBUTING.md to reflect the current state of the repo's issue templates and workflows.

          Here are the extracted facts from the source-of-truth files:

          $FACTS

          Read CONTRIBUTING.md and update ONLY the following sections to match the facts above:
          1. The 'Opening Issues' section — update template names, required fields, labels, and the gh CLI examples
          2. The 'Compliance Rules' section — update the auto-close window (currently listed as 2 hours)
          3. The 'Reporting Bugs' section — update required/optional fields
          4. The 'Requesting Features' section — update required fields and title format
          5. The 'Stale Issues and PRs' section — update stale/close day counts
          6. The 'PR Titles' section — update the conventional commit prefix table

          Do NOT change any other sections. Do NOT change prose style. Only update factual data that differs from the facts JSON.
          If a section already matches the facts, leave it unchanged.
          Write the updated file back to CONTRIBUTING.md."

      - name: Check for changes
        id: diff
        run: |
          if git diff --quiet CONTRIBUTING.md; then
            echo "changed=false" >> $GITHUB_OUTPUT
          else
            echo "changed=true" >> $GITHUB_OUTPUT
          fi

      - name: Create PR
        if: steps.diff.outputs.changed == 'true'
        env:
          GH_TOKEN: ${{ steps.committer.outputs.token }}
        run: |
          BRANCH="docs/sync-contributing-$(date +%Y%m%d-%H%M%S)"
          git checkout -b "$BRANCH"
          git add CONTRIBUTING.md
          git commit -m "docs: sync CONTRIBUTING.md with issue templates and workflow changes"
          git push origin "$BRANCH"
          gh pr create \
            --title "docs: sync CONTRIBUTING.md with issue templates and workflow changes" \
            --body "Automated update triggered by changes to issue templates or workflow files.

          **Changed source files in this push:**
          $(git diff --name-only HEAD~1 HEAD -- \
              .github/ISSUE_TEMPLATE/ \
              .github/workflows/duplicate-issues.yml \
              .github/workflows/compliance-close.yml \
              .github/workflows/stale-issues.yml \
              .github/workflows/close-stale-prs.yml \
              .github/workflows/pr-standards.yml \
            | sed 's/^/- /')

          Please review the diff and merge if correct." \
            --base dev \
            --head "$BRANCH"
```

---

## 5. Scripts Needed

### `extract-contributing-facts.ts`

**Location:** `.github/scripts/extract-contributing-facts.ts`

**Purpose:** Reads all source-of-truth files and writes a structured JSON
summary to `.github/scripts/contributing-facts.json`. This JSON is the
single source of truth passed to the AI agent.

**Pseudocode:**

```typescript
// kilocode_change - new file
import { parse as parseYaml } from "..." // use a bun-compatible yaml parser

// --- Issue templates ---
const templates = []
for (const file of ["bug-report.yml", "feature-request.yml", "question.yml"]) {
  const raw = await Bun.file(`.github/ISSUE_TEMPLATE/${file}`).text()
  const parsed = parseYaml(raw)
  templates.push({
    file,
    name: parsed.name,
    labels: parsed.labels,
    defaultTitle: parsed.title ?? null,
    requiredFields: parsed.body
      .filter((f) => f.validations?.required === true || f.attributes?.options?.some((o) => o.required))
      .map((f) => f.attributes?.label ?? f.id),
    optionalFields: parsed.body
      .filter((f) => !f.validations?.required && !f.attributes?.options?.some((o) => o.required))
      .map((f) => f.attributes?.label ?? f.id),
  })
}

// --- config.yml ---
const config = parseYaml(await Bun.file(".github/ISSUE_TEMPLATE/config.yml").text())
const blankIssuesEnabled = config.blank_issues_enabled

// --- compliance-close.yml ---
// Extract the twoHours constant (2 * 60 * 60 * 1000) → 2 hours
// Parse with regex: /const twoHours = (\d+) \* 60 \* 60 \* 1000/
const complianceRaw = await Bun.file(".github/workflows/compliance-close.yml").text()
const complianceHours = extractComplianceHours(complianceRaw) // → 2

// --- stale-issues.yml ---
const staleRaw = await Bun.file(".github/workflows/stale-issues.yml").text()
const staleParsed = parseYaml(staleRaw)
const issueStaleDays = staleParsed.env.DAYS_BEFORE_STALE // → 90
const issueCloseDays = staleParsed.env.DAYS_BEFORE_CLOSE // → 7
const issueTotalDays = issueStaleDays + issueCloseDays // → 97

// --- close-stale-prs.yml ---
const prStaleRaw = await Bun.file(".github/workflows/close-stale-prs.yml").text()
// Parse: /const DAYS_INACTIVE = (\d+)/
const prStaleDays = extractPrStaleDays(prStaleRaw) // → 60

// --- pr-standards.yml ---
const prRaw = await Bun.file(".github/workflows/pr-standards.yml").text()
// Parse: /const titlePattern = \/\^(.*)\//
// Parse: /const skipIssueCheck = \/\^(.*)\//
const prTitleRegex = extractPrTitleRegex(prRaw)
const skipPrefixes = extractSkipPrefixes(prRaw) // → ["docs", "refactor"]
const conventionalPrefixes = extractConventionalPrefixes(prRaw)
// → ["feat", "fix", "docs", "chore", "refactor", "test"]

const facts = {
  generatedAt: new Date().toISOString(),
  blankIssuesEnabled,
  templates,
  compliance: { windowHours: complianceHours },
  staleIssues: { staleDays: issueStaleDays, closeDays: issueCloseDays, totalDays: issueTotalDays },
  stalePrs: { closeDays: prStaleDays },
  prStandards: {
    titleRegex: prTitleRegex,
    conventionalPrefixes,
    skipIssueLinkPrefixes: skipPrefixes,
  },
}

await Bun.write(".github/scripts/contributing-facts.json", JSON.stringify(facts, null, 2))
console.log("Facts written to .github/scripts/contributing-facts.json")
```

**Example output (`contributing-facts.json`):**

```json
{
  "generatedAt": "2026-02-21T18:00:00.000Z",
  "blankIssuesEnabled": false,
  "templates": [
    {
      "file": "bug-report.yml",
      "name": "Bug report",
      "labels": ["bug"],
      "defaultTitle": null,
      "requiredFields": ["Description"],
      "optionalFields": [
        "Plugins",
        "Kilo version",
        "Steps to reproduce",
        "Screenshot and/or share link",
        "Operating System",
        "Terminal"
      ]
    },
    {
      "file": "feature-request.yml",
      "name": "Feature Request",
      "labels": ["discussion"],
      "defaultTitle": "[FEATURE]:",
      "requiredFields": ["Feature hasn't been suggested before.", "Describe the enhancement you want to request"],
      "optionalFields": []
    },
    {
      "file": "question.yml",
      "name": "Question",
      "labels": ["question"],
      "defaultTitle": null,
      "requiredFields": ["Question"],
      "optionalFields": []
    }
  ],
  "compliance": { "windowHours": 2 },
  "staleIssues": { "staleDays": 90, "closeDays": 7, "totalDays": 97 },
  "stalePrs": { "closeDays": 60 },
  "prStandards": {
    "titleRegex": "^(feat|fix|docs|chore|refactor|test)\\s*(\\([a-zA-Z0-9-]+\\))?\\s*:",
    "conventionalPrefixes": ["feat", "fix", "docs", "chore", "refactor", "test"],
    "skipIssueLinkPrefixes": ["docs", "refactor"]
  }
}
```

---

## 6. Edge Cases and Limitations

### 6.1 Regex parsing of workflow YAML is fragile

The extraction script uses regex to pull constants like `DAYS_INACTIVE = 60`
and `twoHours = 2 * 60 * 60 * 1000` from workflow files. If someone reformats
these expressions (e.g., extracts them to a variable with a different name), the
regex will fail silently and produce wrong facts.

**Mitigation:** The script should throw an error (non-zero exit) if any expected
constant cannot be parsed, causing the workflow to fail visibly rather than
silently producing a bad PR.

### 6.2 AI may hallucinate or over-edit

The `kilo run` step instructs the AI to update only specific sections. However,
AI agents can occasionally drift and modify unintended sections.

**Mitigation:**

- The PR review step is the primary safeguard — a human reviews the diff before
  merging.
- The prompt explicitly lists the sections to update and says "Do NOT change any
  other sections."
- Future improvement: add a post-processing script that validates only the
  expected sections changed (using a git diff parser).

### 6.3 Workflow does not run on PR branches

The `push` trigger only fires on `dev`. If someone opens a PR that changes a
template, the sync workflow won't run until the PR merges.

**Mitigation:** This is intentional — we don't want to create sync PRs for
every draft PR. The sync happens after merge, which is the correct time.

### 6.4 Race condition: two pushes in quick succession

If two pushes to `dev` both touch source files within seconds, two sync PRs
could be opened simultaneously.

**Mitigation:** Both PRs will have different branch names (using
`$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT`). The `$GITHUB_RUN_ATTEMPT` suffix also
ensures workflow re-runs don't collide with a branch from the first attempt.
A maintainer can close the older one. This is an acceptable edge case given the
low frequency of template changes.

### 6.5 `kilo run` requires API keys

The workflow requires `KILO_API_KEY` and `KILO_ORG_ID` secrets. If these are
not set (e.g., in a fork), the workflow will fail.

**Mitigation:** The `workflow_dispatch` trigger allows manual runs. The
extraction step (which doesn't need API keys) still runs and produces the facts
JSON, which can be used for debugging.

### 6.6 PR title format

The sync PR itself must follow the `pr-standards.yml` title regex. The title
`docs: sync CONTRIBUTING.md with issue templates and workflow changes` satisfies
the `docs:` prefix requirement and is exempt from the linked-issue check
(see 6.7).

### 6.7 `docs` and `refactor` PRs skip the linked-issue check

Per `pr-standards.yml`, PRs with `docs:` or `refactor:` prefixes skip the
linked-issue requirement. The sync PR uses `docs:` so it is automatically
exempt — no linked issue is needed.

---

## 7. Implementation Checklist

The following files need to be created or modified, in order:

- [ ] **Create** `.github/scripts/extract-contributing-facts.ts`
      — TypeScript/Bun script that reads source-of-truth files and writes
      `contributing-facts.json`. Includes robust error handling for missing
      constants.

- [ ] **Create** `.github/scripts/contributing-facts.json`
      — Output artifact (gitignored or committed as a reference snapshot).
      Consider adding to `.gitignore` since it is regenerated on every run.

- [ ] **Create** `.github/workflows/sync-contributing.yml`
      — The GitHub Actions workflow described in Section 4. Uses `paths:` filter
      to trigger only when source files change.

- [ ] **Update** `.gitignore` (optional)
      — Add `.github/scripts/contributing-facts.json` if it should not be
      committed to the repo.

- [ ] **Verify** secrets are configured in the repo
      — `KILO_API_KEY`, `KILO_ORG_ID`, `KILO_MAINTAINER_APP_ID`,
      `KILO_MAINTAINER_APP_SECRET` must all be present for the workflow to
      succeed end-to-end.

- [ ] **Test** by making a trivial change to one source file (e.g., add a
      comment to `stale-issues.yml`) and pushing to `dev`, then verifying the
      workflow runs and either opens a PR or exits cleanly.

- [ ] **Optional: add auto-merge** — If the PR diff is small and the CI passes,
      enable auto-merge on the sync PR so it merges without manual intervention.

---

## Appendix: Data Flow Diagram

```
.github/ISSUE_TEMPLATE/
  bug-report.yml          ─┐
  feature-request.yml      │
  question.yml             ├──► extract-contributing-facts.ts
  config.yml               │         │
                           │         ▼
.github/workflows/         │   contributing-facts.json
  duplicate-issues.yml    ─┤         │
  compliance-close.yml     │         ▼
  stale-issues.yml         │   kilo run (AI agent)
  close-stale-prs.yml      │         │
  pr-standards.yml        ─┘         ▼
                                CONTRIBUTING.md (updated)
                                      │
                                      ▼
                               git diff → PR opened
                                      │
                                      ▼
                               Human review + merge
```
