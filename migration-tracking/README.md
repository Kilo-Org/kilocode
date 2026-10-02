# Kilo v2 migration tracking

Planning, progress, validation, and source-parity documentation for the migration of Kilo onto OpenCode v2.

## Structure

```text
migration-tracking/
├── README.md
├── plans/             # Execution plan, public progress plan and milestone history
├── test-plans/        # Test strategy, runtime checks, and UI scenarios
├── marker-audit/      # Source-change inventory and v1-to-v2 assessment
└── technical-notes/   # Supporting design, parity, and validation material
    ├── baseline/
    ├── script/
    └── v2-fork-conventions.md
```

## Plans

- [Execution plan](plans/kilo-opencode-v2-execution-plan.md): the index for finishing the migration: decisions, sequencing, gates (G1 CLI/TUI, G2 VS Code, G3 JetBrains), and the issue register. It changes only when a decision changes. Start here for how the remaining work is organized.
- [Plan and progress](plans/kilo-opencode-v2-plan-progress.md): the public-facing capability inventory, live status per row, and remaining acceptance requirements. Start here for an overview of current status. Its phase table and status line predate the execution plan until the N7 alignment lands.
- [Working log](plans/kilo-opencode-v2-working-log.md): the migration's milestone history. Under the execution plan, new entries are limited to milestones (upstream tag merges, delta sweeps, gate go/no-go decisions, decision changes, notable incidents) and are written by the coordinator only. Earlier entries hold the detailed implementation history; they describe their own checkpoints and may be superseded by later entries.

The working log retains internal coordination references and machine-local paths. It needs editorial review before publication; it is not the public progress summary.

## Test plans

- [Main test plan](test-plans/kilo-opencode-v2-test-plan.md): overall validation plan.
- [Runtime test plan](test-plans/kilo-opencode-v2-test-plan-runtime.md): runtime and backend checks.
- [UI test plan](test-plans/kilo-opencode-v2-test-plan-ui.md): interface and interactive workflow checks.

A listed test is a requirement, not proof that it has passed. Read the recorded execution status and its checkpoint before relying on a result.

## Marker audit

- [Marker inventory](marker-audit/kilo-override-marker-inventory.md): the historical inventory of Kilo change annotations, captured before marker cleanup.
- [Port assessment](marker-audit/v1-kilo-marker-port-assessment.md): the file-level assessment of v1 behavior, its v2 destination, and whether it is ported, native, partial, still needed, deferred, or unnecessary.
- [Assessment data](marker-audit/v1-kilo-marker-port-assessment.tsv): the corresponding tab-separated data for filtering and analysis.

Source assessment and runtime acceptance are different measures. Fewer annotations can reflect relocation into Kilo-owned packages, obsolete changes, or behavior not yet ported; the count alone does not establish parity.

## Technical notes

This folder preserves the material previously collected under the repository's root `kilocode/` directory:

- `baseline/`: focused parity assessments, design decisions, validation records, and remaining gaps.
- `script/`: supporting baseline tooling.
- `v2-fork-conventions.md`: ownership and upstream integration conventions.
- Other topic-specific notes, including session sharing.

Use these notes to understand the reasoning and scope behind progress claims. They are checkpoint-specific supporting material, rather than a second capability checklist.

## Organization and publication status

This directory was assembled by copying existing files. The originals under root `plans/` and `kilocode/` remain intact. The originals are excluded from Git; this directory is the tracked migration collection. The copies are not automatically synchronized. Repository instructions point here, while historical links and tooling paths still need review.

The public progress plan was prepared for external readers. The working log, technical notes, test plans, and audit documents retain their original content and need publication review for internal references, local paths, and outdated statements. Relative links and script paths inherited from the original locations may also need adjustment before the copies become the maintained versions.

When updating this collection, keep decisions and sequencing in the execution plan, capability progress in the public plan, milestones in the working log, per-change evidence in the PR and its issue, test execution status in the test plans, and file-level mapping in the marker audit. Preserve the distinction between implemented behavior, source-reviewed equivalence, and verified end-to-end acceptance.
