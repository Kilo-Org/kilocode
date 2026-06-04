---
title: "Feature Proposal Template"
description: "Template for proposing new feature designs"
---

# Feature proposal template

{% callout type="info" title="Status" %}
Proposal - replace this sentence with concise status detail. Use Partial only when page clearly separates shipped behavior from roadmap.
{% /callout %}

## Status guidance

Every proposal page must include visible Status callout near title. Use one lifecycle label:

| Status | Use when |
|---|---|
| `Proposal` | Design only; no matching implementation exists |
| `Partial` | Some pieces shipped; page separates current behavior from roadmap |
| `Historical` | Page remains for design history; implementation shipped elsewhere or changed materially |
| `Superseded` | Another proposal or implementation reference replaced page |

For `Partial` pages, add separate current implementation and roadmap tables. Do not mix shipped behavior with tentative schema, endpoints, commands, or rollout claims.

## Overview

Describe problem and proposed solution. State intended outcome and boundaries. Keep scope small enough to ship and evaluate.

## Requirements

List minimum requirements needed for proposed solution.

-

### Non-requirements

List work intentionally excluded from this proposal.

-

## Current implementation

For `Partial` proposals, list shipped capabilities with evidence scope. Remove this section for design-only proposals.

| Capability | Status | Notes |
|---|---|---|
| Example capability | Current | Describe verified current behavior |

## Roadmap

List tentative behavior separately from current implementation.

| Capability | Status | Proposed behavior |
|---|---|---|
| Example capability | Planned | Describe intended change |

## System design

Document proposed architecture and implementation decisions. Mark tentative schema, endpoints, commands, and vendor integrations as proposed until verified.

## Scope and implementation

List work items that can become GitHub issues.

-

## Compliance considerations

Describe relevant security, privacy, data-handling, and SOC 2 considerations.

## Future work

List ideas intentionally deferred beyond current proposal.
