---
name: pr-track-v1
description: Create a GitHub tracking issue in Kilo-Org/kilocode that captures a merged Kilo v1 PR's behavior so it can be re-implemented or verified in opencode v2. Use when the user invokes /pr-track-v1 or asks to track a v1 core fix/feature for the v2 rewrite.
---

# Track V1 Change For V2

opencode v2 is a complete rewrite, so Kilo v1 fixes and features do not carry over automatically. This
skill records *what the behavior was and why it mattered* in enough detail that a v2 agent can either
confirm v2 already covers it or implement it from scratch without reading v1 code.

The `/pr-track-v1` command is the normal entry point. Its arguments are optional context, not text to
paste blindly into the issue.

## Outcome

Finish with an issue in `Kilo-Org/kilocode` that:

- Is titled `[v2-port] <summary>`, labeled `core-v1-changes-port`, and assigned to `@me`.
- Opens with the auto-created provenance banner naming the source PR.
- Describes the problem, the user-visible behavior contract, edge cases, and acceptance criteria — not
  a file-by-file diff narration.
- Ends with a paste-ready `Prompt For V2 Agent` block.
- Is linked back from a comment on the source v1 PR.
- Contains no placeholders, invented motivations, or unverified claims.
- Is reused rather than duplicated when a tracking issue for the same PR already exists.

## Resolve The Source PR

1. Run `gh auth status` and confirm access.
2. Resolve the target repo explicitly on every `gh` call: pass `--repo Kilo-Org/kilocode`. The user may
   invoke this from a worktree or from another repository.
3. Arguments may contain PR numbers, PR URLs, or several of them. With no argument, resolve the current
   branch's PR and confirm it is the intended one:

   ```bash
   gh pr view --repo Kilo-Org/kilocode --json number,url,title,state
   ```

4. Do not guess. If no PR can be resolved, ask for the PR number instead of inventing one.

## Inspect The Change

Gather the behavior, not the implementation:

```bash
gh pr view <N> --repo Kilo-Org/kilocode \
  --json number,url,title,body,state,mergedAt,mergeCommit,author,labels,files,commits,comments,reviews,closingIssuesReferences
gh pr diff <N> --repo Kilo-Org/kilocode
```

Priority sources for functional detail, in order:

1. The PR body (problem / rationale / user-impact sections) and the changeset file in the diff. The
   changeset is written for end users and is the best one-line summary.
2. Tests added or changed in the diff. They state the behavior contract and the edge cases.
3. Linked issues (`closingIssuesReferences`) and review discussion. These hold the constraints and
   rejected alternatives that a rewrite is most likely to re-break.
4. The code diff, last, and only to extract intent: ordering, retries, defaults, platform quirks.

Also record:

- The affected surface: CLI/core, VS Code extension, JetBrains, gateway, or SDK.
- Any config key, flag, env var, default, persisted state, or telemetry event introduced or changed.
- Whether the change was a Kilo behavior change or an upstream-opencode workaround.

If the PR has no Kilo-specific behavior worth carrying over — dependency bump, pure upstream merge,
formatting-only change — say so and stop without creating an issue.

## Avoid Duplicates

```bash
gh issue list --repo Kilo-Org/kilocode --label core-v1-changes-port --state all \
  --search "pull/<N>" --json number,url,title
```

If a match references the same PR, report its URL and do not create a second issue. Update the existing
body only when the user asks for it.

## Ensure The Label Exists

```bash
gh label list --repo Kilo-Org/kilocode --search core-v1-changes-port
gh label create core-v1-changes-port --repo Kilo-Org/kilocode --color 5319e7 \
  --description "Kilo core v1 change to re-implement or verify in opencode v2"
```

Create the label only when the search returns no exact match. Treat an "already exists" error as
success. If creation fails on permissions, report it rather than creating the issue unlabeled.

## Title

Use `[v2-port] <summary>`:

- Derive the summary from the user-visible outcome, not the branch name or commit subject.
- Imperative, standalone-readable. No conventional-commit type and no `[JetBrains]` / `[VS Code]`
  prefixes.
- Keep the whole title under 80 characters when practical.
- Example: `[v2-port] Keep queued user messages when a session aborts mid-stream`.

## Issue Body

Write the body to a temporary Markdown file and pass it with `--body-file` so multiline content and
nested fences stay intact. Use this template:

````markdown
> Auto-created by `/pr-track-v1` from Kilo v1 PR #<N>. The summary below is generated from that PR's
> changes, tests, and discussion for the opencode v2 rewrite — review it before planning.

## Context

<1-3 sentences: what the change was, which surface it affected, and whether it was a fix, feature, or
behavior change.>

## Problem In V1

<The concrete bug, limitation, or missing capability. Include the user-visible symptom and the exact
conditions that trigger it.>

## Behavior To Preserve In V2

- <User-visible behavior / contract item.>
- <Edge case, race, or failure mode that was explicitly handled.>
- <Config key, flag, default, env var, persisted state, or telemetry event introduced or changed.>

## Non-Goals

<What v1 intentionally did not handle, and v1-specific implementation that should not be carried over.
Write `None.` when there is nothing.>

## Why This May Not Carry Over Automatically

<Why a rewrite could plausibly miss it: non-obvious edge case, ordering or race, platform quirk,
upstream workaround. If v2's architecture likely covers it already, say that instead.>

## Acceptance Criteria

- [ ] Confirmed whether opencode v2 already provides this behavior, and where.
- [ ] If missing, behavior implemented idiomatically in v2 (not a code port).
- [ ] <Specific checkable verification, ideally derived from the v1 tests.>

## V1 Reference

- Source PR: <url> — `<title>`, merged <date>
- Linked issues: <refs or `None.`>
- Key v1 code (reference only, v2 is a rewrite): `path/to/file.ts:NN` — <one line on why it matters>

## Prompt For V2 Agent

```
You are working in the opencode v2 codebase. Kilo v1 shipped this behavior: <summary>.

First determine whether v2 already provides it. If it does, report where and stop.

If it does not, implement it idiomatically for v2 — do not port v1 code structure.

Required behavior:
- <contract item>
- <edge case>

Verify by: <check or test>.

Background (v1, different architecture): <PR url>.
```
````

Body rules:

- Functional detail is the product. Keep code references to at most a few lines, and only when they
  carry intent a rewrite would miss. Omit `Key v1 code` entirely when the prose already covers it.
- Never invent symptoms, issue links, telemetry names, or config keys. If the PR does not record why
  the change was made, write that the rationale is not recorded in the PR.
- Resolve every `<placeholder>` before creating the issue.

## Create, Assign, Link

```bash
gh issue create --repo Kilo-Org/kilocode \
  --title "$title" \
  --body-file "$body" \
  --label core-v1-changes-port \
  --assignee @me
```

Do not pass `--project` and do not use an issue template. These are internal v2 planning trackers, so
the board requirement in the repository's `gh-issues` skill does not apply. If `--assignee @me` fails
because the user is not assignable, report it instead of leaving the issue silently unassigned.

Then link back from the source PR:

```bash
gh pr comment <N> --repo Kilo-Org/kilocode \
  --body "Tracked for the opencode v2 rewrite in #<issue-number> (\`core-v1-changes-port\`)."
```

Delete the temporary body file. If the PR comment fails (locked PR, permissions), keep the issue and
report the failure rather than retrying blindly.

## Verify

1. `gh issue view <issue> --repo Kilo-Org/kilocode --json url,title,labels,assignees,body`.
2. Confirm the `[v2-port]` title, the `core-v1-changes-port` label, the `@me` assignee, every section
   present exactly once, and no unresolved placeholder.
3. Confirm the back-link comment is visible with:
   `gh pr view <N> --repo Kilo-Org/kilocode --json comments`.
4. Return the issue URL, the source PR, the one-line summary, and anything a human must fill in.

## Multiple PRs

Process each PR independently and return one line per PR: the issue URL, or the reason it was skipped.
When one PR clearly contains several independent behaviors, ask once whether to split before creating
issues.
