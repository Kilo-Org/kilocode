---
title: "Code Review"
description: "How the refinery agent reviews and merges code"
---

# {% $markdoc.frontmatter.title %}

Every piece of code produced by Gas Town agents goes through automated review before merging. The **refinery** agent is dedicated to critiquing, verifying, and gatekeeping what lands in your codebase.

## The Review Pipeline

When a polecat finishes a bead and pushes its branch, the work enters the review pipeline:

{% flowDiagram name="adversarial-loop" height="340px" /%}

{% browserFrame url="app.kilo.ai/gastown/town/rigs/main" caption="A bead in review — the refinery is evaluating the polecat's work" %}
{% image src="/docs/img/gastown/gt-rig-page-convoy-bead-in-review.png" alt="Gas Town rig page showing a bead in review status" /%}
{% /browserFrame %}

The refinery evaluates:
- **Correctness** — does the code do what the task asked?
- **Style** — does it follow project conventions?
- **Completeness** — are tests included? Are edge cases handled?
- **Safety** — any security issues, data leaks, or breaking changes?

## Micro-Adversarial Loops

The core insight behind Gas Town's review system is **adversarial iteration**. Rather than one agent producing a final answer, two agents with different objectives improve the output through tension:

{% flowDiagram name="adversarial-loop" height="340px" /%}

This pattern is fundamentally different from having a single agent self-review:
- Self-review has a **confirmation bias** — the same "mind" that wrote the code evaluates it
- Adversarial review creates **genuine tension** — the refinery has different priorities than the polecat
- Each revision cycle **measurably improves** the output because feedback is specific and actionable

### The Loop in Practice

A typical bead goes through 1-2 revision cycles:

| Cycle | What happens |
|---|---|
| **Write** | Polecat reads the task, writes code, runs tests, pushes |
| **Review 1** | Refinery finds 2 issues: missing test case, inconsistent naming |
| **Revise 1** | Polecat adds the test, fixes naming, pushes again |
| **Review 2** | Refinery approves — code meets quality bar |
| **Merge** | Code lands on target branch |

After 3 failed revision cycles, the bead escalates rather than looping forever.

## Merge Strategies

Gas Town supports two merge strategies, configurable per-town or per-rig:

### Direct Merge

The refinery merges directly to the target branch (convoy feature branch or main) without creating a GitHub PR. This is faster but gives you less visibility into individual merges.

**Best for:** trusted agent output, internal projects, rapid iteration.

### Pull Request Mode

The refinery creates a GitHub PR for each merge. The PR includes:
- The diff
- Review comments from the refinery
- Status checks from CI

You can configure whether PRs auto-merge after refinery approval or require human approval.

**Best for:** production codebases, team environments, audit trails.

## Convoy-Level Review

Convoys add an additional review layer beyond per-bead review:

{% flowDiagram name="convoy-execution" height="200px" /%}

{% browserFrame url="app.kilo.ai/gastown/town/merges" caption="The merge queue — review detail showing refinery feedback" %}
{% image src="/docs/img/gastown/gt-merge-queue-page-review-detail.png" alt="Gas Town merge queue with review detail" /%}
{% /browserFrame %}

| Review Layer | What's checked | Who reviews |
|---|---|---|
| Per-bead | Individual contribution quality | Refinery agent |
| Landing | Combined feature coherence | Refinery agent |
| Human (optional) | Business logic, architecture | Your team |

## Combining with Kilo Code Review

Gas Town's refinery works independently, but combining it with [Kilo Code Review](/docs/code-with-ai/platforms/cloud-agent) creates an even stronger pipeline:

1. **Agent writes** → agent-level refinery reviews (fast, automated)
2. **Code lands as PR** → Kilo Code Review provides human-readable review (deeper, contextual)
3. **Human approves** → code ships

This gives you automated adversarial review for speed **plus** AI-assisted human review for judgment — the best of both approaches.

## The Merge Queue

The merge queue page shows all active and completed reviews in your town:

{% browserFrame url="app.kilo.ai/gastown/town/merges" caption="The merge queue — all reviews at a glance" %}
{% image src="/docs/img/gastown/gt-merge-queue-page.png" alt="Gas Town merge queue page" /%}
{% /browserFrame %}

## Review Configuration

Customize the refinery's behavior in **Town Settings** → **Review**:

| Setting | Options | Default |
|---|---|---|
| `review_mode` | `always` / `never` / `pr_only` | `always` |
| `merge_strategy` | `direct` / `pr` | `direct` |
| `auto_merge` | `true` / `false` | `true` |
| `review_gates` | Strictness level (1-5) | 3 |
| `max_review_cycles` | How many revision attempts | 3 |

### Review Mode

- **`always`** — every bead goes through refinery review (recommended)
- **`never`** — skip review, merge directly on polecat completion (fast but risky)
- **`pr_only`** — only review work that creates a PR

### Review Gates

Higher gate levels make the refinery stricter:
- **Level 1** — basic sanity (compiles, doesn't break tests)
- **Level 3** — standard (style, tests, correctness) — default
- **Level 5** — strict (architecture review, performance, security)

## Handling Review Feedback

When the refinery rejects a submission, it provides specific, actionable feedback. The polecat receives this feedback and revises accordingly. You can see the feedback exchange in the bead's event history.

If a bead fails review 3 times, it transitions to `failed` and creates an **escalation** for human attention. This prevents infinite loops while ensuring difficult code doesn't slip through without proper quality.
