---
title: "Auto Triage"
description: "Automate GitHub issue triage with AI assistance"
---

# Auto-Triage

Kilo's **Auto-Triage** automatically analyses every new GitHub issue the moment it is opened. Within minutes of a reporter submitting an issue, Auto-Triage reads the title and body, checks whether the issue is a duplicate of something already reported, classifies it as a **bug**, **feature request**, **question**, or **unclear**, and applies the appropriate labels — all without any manual effort from your team.

---

## What it does

### 1. Duplicate detection

When an issue arrives, Auto-Triage compares it against every previously-triaged issue in your repository using vector-similarity search. If it finds a match, it:

- Posts a comment on the new issue linking to the original, including its title and similarity score.
- Labels the issue `kilo-triaged` and `kilo-duplicate`.
- Marks the triage ticket as actioned.

### 2. Classification

An AI model of your choice reads the full title and body and assigns one of four classifications:

| Classification | Meaning                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **bug**        | Existing, documented functionality is broken. Includes issues with stack traces, error messages, or clear reproduction steps. |
| **feature**    | A request for new functionality or an enhancement to existing behaviour.                                                      |
| **question**   | The reporter is asking for help, clarification, or pointing to a gap in documentation.                                        |
| **unclear**    | The issue does not contain enough information to determine intent.                                                            |

Along with the classification, the model produces a confidence score (0–1), a short summary of what the reporter wants, and its reasoning.

### 3. Automatic labelling

After classification, Auto-Triage applies labels to the issue on GitHub:

- `kilo-triaged` is always applied to every issue that completes triage.
- The AI selects zero or more **additional labels** from your repository's existing label set — it will only ever choose labels that already exist in your repo, never invent new ones.
- Labels you have configured as **skip labels** or **required labels** (see [Configuration](#configuration-reference) below) are excluded from the AI's choices so they remain under your control.

### 4. Ticket history

Every triage run is recorded as a ticket in the Kilo dashboard. You can:

- Filter tickets by status, classification, or repository.
- View the AI's classification, confidence score, intent summary, and reasoning.
- **Retry** a failed ticket to reprocess it from scratch.

---

## How to enable it

### Prerequisites

- A GitHub integration connected to your Kilo account or organisation.
- The repositories you want to triage must be accessible via that integration.

### Steps

1. Go to **Auto-Triage -> Config** in the Kilo dashboard.
2. Toggle **Enable AI Auto-Triage** on.
3. Choose which repositories to triage:
   - **All repositories** — every repository accessible via your GitHub integration.
   - **Selected repositories** — only the repositories you explicitly choose.
4. Click **Save**.

From this point, any new issue opened (or reopened) in a configured repository will be automatically queued for triage.

---

## Configuration reference

All settings are found under **Auto-Triage -> Config**.

### Repository scope

| Setting                       | Description                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Repository selection mode** | `all` — triage every accessible repository. `selected` — triage only the repositories you pick from the list. |

### Label filters

These settings let you control which issues Auto-Triage processes, using labels already on the issue at the time it is opened.

| Setting             | Description                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Skip labels**     | If an issue carries **any** of these labels when it is opened, Auto-Triage will ignore it entirely. Useful for issues you handle manually, e.g. `wontfix` or `on-hold`.         |
| **Required labels** | If set, Auto-Triage will only process issues that carry **all** of these labels. Useful for opt-in triage flows, e.g. requiring a `needs-triage` label before Auto-Triage runs. |

> **Note:** Skip labels and required labels are also excluded from the set of labels the AI can apply. This keeps gating labels strictly under your control.

### AI model

The model used for classification.

---

## Ticket statuses

| Status        | Meaning                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------ |
| **pending**   | Queued and waiting for a processing slot.                                                  |
| **analyzing** | The AI is actively processing the issue.                                                   |
| **actioned**  | Triage completed. Labels applied, duplicate comment posted if applicable.                  |
| **failed**    | Something went wrong. The error is shown in the ticket. You can retry.                     |
| **skipped**   | The issue did not meet the configured requirements (wrong repo, skip label present, etc.). |

---

## Labels applied by Auto-Triage

Auto-Triage uses two reserved labels for tracking. You should create these in your GitHub repositories before enabling the feature:

| Label            | Meaning                                                                       |
| ---------------- | ----------------------------------------------------------------------------- |
| `kilo-triaged`   | Applied to every issue that completes triage successfully.                    |
| `kilo-duplicate` | Applied alongside `kilo-triaged` when the issue is identified as a duplicate. |

These labels are managed by Kilo and should not be added to your **skip labels** list.
