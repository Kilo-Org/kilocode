---
name: data-investigation
description: >-
  A workflow for conducting rigorous, reproducible data investigations and
  ad-hoc analyses. This skill should be used when investigating a business
  question, explaining a metric anomaly, validating a hypothesis, performing
  root cause analysis, or preparing a one-off investigation dashboard or memo.
license: MIT
metadata:
  category: development
  author: Pedro / Kilo Code
---

# Data Investigation

Use this skill to produce investigations that are fast, correct, reproducible,
and communicate a clear conclusion rather than a pile of charts.

## Purpose

Every investigation should be answerable in one sentence before the first SQL
query is written.

## Phase 1: Frame Before Querying

### 1. Write the one-sentence answer first

Before writing any SQL, write the sentence the conclusion is expected to be.

Example: `The cohort size gap is a definition problem rather than a product behavior problem.`

If the sentence cannot be written, the question is not yet understood.

### 2. Classify the investigation type

| Type | Trigger | Approach |
|---|---|---|
| Gap analysis | Why do A and B not match? | Establish the gap, localize it, explain it |
| Root cause | Why did this metric change? | Confirm real, isolate segment, align timing, validate mechanism |
| Hypothesis test | Is X causing Y? | Define what must be true, test sub-claims, confirm or reject |
| Feasibility check | Is this number trustworthy? | Check grain, joins, nulls, definition overlap |

### 3. State 2-3 competing hypotheses before querying

Never investigate with a single hypothesis. That creates confirmation bias.

Order hypotheses by plausibility and note which one is currently expected to be
correct and why.

## Phase 2: Build Queries In Escalating Specificity

### 1. Establish first, explain second

Step 1 always confirms the anomaly is real and measures its magnitude.
Do not jump to cause until the effect is confirmed.

```sql
select
    <time_bucket>,
    <source_a_count> as metric_a,
    <source_b_count> as metric_b,
    <source_a_count> - <source_b_count> as gap,
    round(100.0 * (<source_a_count> - <source_b_count>) / nullif(<source_a_count>, 0), 1) as pct_gap
from ...
order by 1
```

### 2. Localize by breaking one dimension at a time

After confirming the gap, break it down along one dimension per step:
- By time: when did it appear?
- By segment: who is affected?
- By signal/source: which path is missing?

### 3. Align timing with upstream changes

Once the anomaly start date is known, check:
- git commits to relevant models, ETL jobs, or application code
- schema migrations or source changes
- metric definition changes
- external events such as launches, campaigns, or pricing changes

A credible root cause must explain why the metric changed when it did.

### 4. Validate the mechanism

After identifying a candidate cause, confirm it mechanically:
- Does the affected population match the predicted population?
- What does the counterfactual look like?
- Does a second independent signal support the explanation?

Do not stop at correlation.

### 5. Quantify each hypothesis before concluding

For every candidate explanation, produce a number.

Examples:
- `H1 accounts for 1,240 users`
- `H2 accounts for 1,050 users`

If a hypothesis cannot be quantified, it is not yet validated.

## Phase 3: SQL Hygiene Rules

### Use stable time bounds for investigations

Investigation SQL should be reproducible. Favor fixed bounds over rolling
windows unless the analysis is intentionally operational and evergreen.

```sql
-- Prefer fixed investigation scope
where created_at >= '2026-02-16'
  and created_at < '2026-04-04'
```

### Add explicit grain comments in important CTEs

```sql
-- grain: one row per user
with users as (
    ...
)
```

### Prefer named comparison outputs over raw aggregates

Bad:

```sql
select count(*) from ...
```

Better:

```sql
select
    count(*) as users_in_scope,
    count(distinct org_id) as orgs_in_scope
from ...
```

### Keep diagnostic queries small and discardable

Diagnostic SQL exists to answer one question. Do not build giant reusable
queries too early.

## Phase 4: Communication Rules

### Lead with the answer

The first sentence of the written output should state the conclusion.

Bad:

`I looked at several possible explanations for the discrepancy.`

Good:

`The discrepancy is caused by internal users being excluded from the dashboard query but included in the warehouse baseline.`

### Separate evidence from interpretation

Use a structure like:

1. Conclusion
2. Evidence
3. Why alternative hypotheses were rejected
4. Recommended next action

### Include the limiting assumption

Every investigation should state the biggest assumption that could change the
answer.

Example:

`This conclusion assumes backend event timestamps are complete for the affected week; if ingestion was delayed, the gap may be overstated.`

## Phase 5: Output Standard

Every completed investigation should leave behind:

1. One-sentence answer
2. Final supporting SQL or notebook
3. A note on rejected hypotheses
4. Any follow-up question or unresolved ambiguity

## Common Failure Modes

- Treating a metric definition dispute as a product issue
- Comparing sources with different grain or freshness
- Accepting the first plausible explanation without quantification
- Writing one giant query too early
- Ending with charts instead of an answer

## Related Skills

- Use `answering-natural-language-questions-with-dbt` when the goal is answering a business question rather than debugging why analysis or metrics disagree.
