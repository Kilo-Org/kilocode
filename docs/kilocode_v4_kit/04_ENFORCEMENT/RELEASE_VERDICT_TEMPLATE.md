# Release Verdict

> **Instructions:** Complete this document before any release reaches production. Every section
> must be filled. The Release Judge owns this document and is responsible for the Final Decision.
> A release cannot ship until this document has sign-off from the Release Judge, Program Director,
> and Evidence Steward.

---

## Release Version
<!-- Semantic version for this release. Must match the tag that will be applied to the commit. -->

**Example:**
> KiloCode v4.0.0

---

## Release Date
<!-- Target release date. If the release slips, update this field and add a note explaining why. -->

**Example:**
> 2026-05-01

---

## Scope Included
<!-- Which blocks and phases are included in this release. Every listed phase must have a -->
<!-- completed Acceptance Report with a PASS or CONDITIONAL PASS gate result. -->

| Block | Phases | Title | Status |
|-------|--------|-------|--------|
| A -- Truth & Inventory | 01-10 | Establish source-of-truth, matrix, ledger, inventory, architecture, config, evidence layout, gates, drift scan | Complete |
| B -- Operator Workflows | 11-16 | Top 12 workflows, risk scoring, approval mapping, provider/memory/execution requirements | Complete |
| C -- SSH Core | 17-26 | Profile schema through failure paths | Complete |
| D -- VPS Management | 27-34 | Inventory model through incident/recovery | Complete |
| E -- ZeroClaw | 35-44 | Task intake through rollback/retry | Complete |
| F -- Provider Routing | 45-52 | Role matrix through cost/trace display | Complete |
| G -- Memory | 53-58 | Shiba connectivity through failure-path handling | Complete |
| H -- Training/GPU | 59-66 | Dataset registry through export/package | Complete |
| I -- Governance & Release | 67-72 | Authority tiers through release verdict | Complete |

---

## Scope Excluded
<!-- What is intentionally NOT in this release and why. Be explicit -- unlisted features are -->
<!-- assumed to not exist. If nothing is excluded, write "None". -->

| Feature / Block | Reason | Target Release |
|-----------------|--------|----------------|
| Multi-cluster GPU scheduling | Deferred -- requires k8s operator not yet built | v4.1.0 |
| Federated memory across orgs | Design not finalized | v4.2.0 |
| None | | |

---

## Critical Defects
<!-- Any unresolved defects with severity Critical or High from the Defect Ledger. -->
<!-- A release CANNOT ship with unresolved Critical defects. High defects require explicit -->
<!-- mitigation and Release Judge approval. -->

| Defect ID | Severity | Phase | Description | Mitigation | Release-Blocking? |
|-----------|----------|-------|-------------|------------|-------------------|
| None | | | | | |

---

## Risk Summary
<!-- Risks to this release. Include technical, operational, and schedule risks. -->
<!-- Likelihood: Low / Medium / High. Impact: Low / Medium / High / Critical. -->

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Provider API rate limits under launch load | Medium | High | Pre-provisioned quota, fallback chain to SiliconFlow |
| SSH key migration from legacy format | Low | Medium | Migration script tested, rollback preserves originals |
| Memory service cold-start latency | Low | Medium | Warm-up job runs before release window opens |

---

## Test Summary
<!-- Aggregated test results across all subsystems. Pull numbers from individual Acceptance -->
<!-- Reports and CI/CD pipeline results. -->

| Suite | Total | Passed | Failed | Skipped | Notes |
|-------|-------|--------|--------|---------|-------|
| Unit tests | | | | | |
| Integration tests | | | | | |
| End-to-end tests | | | | | |
| Failure-path tests | | | | | |
| Security scans (bandit) | | | | | |
| Complexity analysis (lizard) | | | | | |
| Parity check (`parity_check.py`) | | | | | |
| Truth validation (`truth_validator.py`) | | | | | |
| Routing validation (`routing_validator.py`) | | | | | |

---

## Rollback Readiness
<!-- Every release must have a tested rollback plan. A release CANNOT ship without one. -->

- [ ] Rollback procedure documented in `evidence/release-vX.Y.Z/rollback-procedure.md`
- [ ] Rollback tested in staging environment
- [ ] Rollback notification chain defined (who gets notified, in what order)
- [ ] Previous version artifact available for restore
- [ ] Database migration is reversible (if applicable)
- [ ] Feature flags allow partial rollback (if applicable)

**Rollback command:**
```bash
# Example -- replace with actual rollback command for this release
git tag -f rollback-checkpoint && git revert --no-commit HEAD~N && git commit -m "rollback: revert to vX.Y.Z"
```

**Estimated rollback time:** ___ minutes

**Rollback verification steps:**
1. Confirm previous version is running: `<command>`
2. Verify core functionality: `<smoke test command>`
3. Check error rates return to baseline: `<monitoring command>`

---

## Evidence Bundle Path
<!-- Path to the complete evidence bundle for this release. This directory must contain: -->
<!--   - All Acceptance Reports for included phases -->
<!--   - All screenshots, test logs, config samples, and transcripts -->
<!--   - The truth matrix snapshot at time of release -->
<!--   - The defect ledger snapshot at time of release -->
<!--   - CI/CD pipeline output -->

```
evidence/release-vX.Y.Z/
  acceptance-reports/
    phase-01-10.md
    phase-11-16.md
    ...
  screenshots/
  test-logs/
  config-samples/
  truth-matrix-snapshot.md
  defect-ledger-snapshot.md
  pipeline-output.log
```

---

## Approvals
<!-- Each role must record their verdict and date. A release requires PASS from all three. -->
<!-- If any role records FAIL, the release is blocked until the issue is resolved. -->
<!-- If any role records CONDITIONAL, the conditions must be listed in the Final Decision. -->

| Role | Agent/Person | Verdict | Date | Notes |
|------|-------------|---------|------|-------|
| Release Judge | | PASS / CONDITIONAL / FAIL | | |
| Program Director | | PASS / CONDITIONAL / FAIL | | |
| Evidence Steward | | PASS / CONDITIONAL / FAIL | | |

---

## Final Decision

- **Decision:** PASS / CONDITIONAL PASS / FAIL
- **Conditions (if conditional):**
  <!-- List every condition. Each must have an owner, deadline, and tracking mechanism. -->
  1. _Condition_ -- Owner: ___, Deadline: ___, Tracked in: ___
- **Release authorized by:** _______________
- **Date:** _______________
- **Release tag:** `vX.Y.Z`
- **Release commit:** `<sha>`

---

> **Release Rules:**
> - A release CANNOT ship with any unresolved Critical defect.
> - A release CANNOT ship without a tested rollback procedure.
> - A release CANNOT ship if any included phase has a FAIL gate result.
> - A CONDITIONAL PASS requires all conditions to be met within the stated deadline;
>   failure to meet conditions automatically converts the verdict to FAIL and triggers
>   a patch release or rollback.
> - The Evidence Steward must verify that the evidence bundle is complete and matches
>   the truth matrix before signing off.
