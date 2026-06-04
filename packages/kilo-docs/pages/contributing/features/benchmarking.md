---
title: "Benchmarking"
description: "Current evaluation evidence and roadmap for benchmarking Kilo Code"
---

# Benchmarking

{% callout type="info" title="Status" %}
Partial - inspected repositories show a Harbor-facing smoke-eval workflow and cloud `model-eval-ingest` promotion sync. Broader Harbor adapters, ATIF traces, Opik workflows, and commands remain unverified roadmap items.
{% /callout %}

## Overview

Benchmarking should answer two questions:

1. How do models compare when used by same Kilo Code agent?
2. How do agents or Kilo Code versions compare when used with same model?

This page separates inspected repository evidence from roadmap. It does not guarantee private benchmark tooling, external adapters, or example commands are available to contributors.

{% callout type="info" %}
Benchmarking is separate from [production observability](/docs/contributing/features/agent-observability). Observability monitors real sessions. Benchmarking runs controlled evaluation tasks.
{% /callout %}

## Current evidence

| Capability | Status | Evidence and limits |
|---|---|---|
| Harbor-facing smoke eval | Current workflow | `.github/workflows/smoke-test.yml` checks out private `Kilo-Org/kilo-bench`, installs dependencies, and runs two smoke tasks through repository scripts |
| CLI release smoke coverage | Current workflow | Workflow can test latest npm CLI or requested release asset before validating results |
| Smoke result artifacts | Current workflow | Workflow uploads result, trajectory, and agent setup files for inspection |
| Cloud model eval ingest | Current service | Static source inspection found `services/model-eval-ingest/` promotion sync surface |
| Private `kilo-bench` internals | Not verified here | Private repository scripts, adapter behavior, and supported local commands are outside inspected docs scope |
| Live production enablement | Not verified here | Static source does not prove deployment, rollout, retention, or vendor configuration |

## Roadmap

| Capability | Status | Intended use |
|---|---|---|
| Contributor-facing Harbor adapter | Unverified roadmap | Run Kilo CLI autonomously in controlled evaluation environments |
| ATIF trajectory adapter | Unverified roadmap | Emit structured step-level traces for comparison |
| Opik integration | Unverified roadmap | Ingest traces and compare evaluation runs |
| Standard model comparison workflow | Planned | Compare quality, cost, and wall-clock time across models |
| Standard agent comparison workflow | Planned | Compare agents or Kilo Code versions on same tasks |
| Custom task-set template | Planned | Build focused regression or capability suites |
| CI regression suite beyond smoke eval | Planned | Run stable subset before release |

## Inspected smoke-eval workflow

Current repository workflow runs small smoke evaluation after checking out private benchmark repository. It uses private repository script `./scripts/run_eval.sh`, validates output with `scripts/validate_smoke_test.py`, and uploads selected artifacts.

| Task | Dataset selection | Expected scope recorded in workflow |
|---|---|---|
| `hello-world` | `hello-world` | Small smoke task |
| `log-summary-date-ranges` | `terminal-bench-sample` with included task name | Small terminal benchmark sample |

This evidence shows smoke coverage exists. It does not establish public Harbor adapter contract or contributor-ready local CLI.

## Cloud model-eval-ingest evidence

Static source inspection found cloud `model-eval-ingest` service for promotion sync. Treat this as current repository-defined surface only. Validate deployed environment and operational behavior separately before making production claims.

## Proposed evaluation design

Broader design can use open-source evaluation components if adapter availability is verified during implementation.

| Component | Roadmap role | Verification needed |
|---|---|---|
| [Harbor](https://harborframework.com) | Evaluation harness and datasets | Confirm supported Kilo adapter and invocation contract |
| [ATIF](https://harborframework.com/docs/agents/trajectory-format) | Structured trajectories | Confirm emitted fields and reasoning-data policy |
| [Opik](https://www.comet.com/docs/opik) | Trace ingestion and analysis | Confirm Harbor integration setup and Kilo adapter support |
| Terminal-Bench or other datasets | Controlled tasks | Confirm versions, licensing, and task selection |

Potential architecture:

```text
Evaluation task set
  -> controlled trial environment
  -> verified Kilo adapter
  -> model request
  -> result and optional trajectory artifacts
  -> smoke validation, aggregate analysis, or trace analysis
```

## Proposed comparison dimensions

| Comparison | Fixed input | Variable | Measures |
|---|---|---|---|
| Model comparison | Kilo Code agent and task set | Model | Completion, cost, and wall-clock time |
| Agent comparison | Model and task set | Agent or Kilo Code version | Completion, cost, and wall-clock time |
| Trace analysis | Evaluation task | Run trajectory | Tool choices, errors, and repeated steps |

## Command verification requirement

Do not document `opik harbor run -a kilo`, `kilo --auto`, or `kilo run --auto` as ready-to-run interfaces until adapter and autonomous CLI invocation are verified in relevant repository. Private `kilo-bench` workflow commands are implementation evidence, not public usage guarantees.

## Future deliverables

- Verify and document supported autonomous CLI invocation
- Verify Harbor adapter ownership and availability
- Define ATIF export fields and data-handling policy
- Validate Opik ingestion path before publishing commands
- Publish contributor workflow only after local reproduction succeeds
- Expand smoke coverage into stable regression subset where cost and runtime allow

## References

- [Harbor Framework Documentation](https://harborframework.com/docs)
- [ATIF Specification](https://github.com/laude-institute/harbor/blob/main/docs/rfcs/0001-trajectory-format.md)
- [Opik Harbor Integration](https://www.comet.com/docs/opik/integrations/harbor)
