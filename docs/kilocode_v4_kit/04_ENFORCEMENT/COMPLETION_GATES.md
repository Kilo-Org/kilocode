# Completion Gates and Hard-Stop Rules

Date: 2026-04-17

## Phase Completion Gate (applies to EVERY phase)

A phase can only transition from InProgress to Complete when ALL of the following are true:

### Mandatory Checklist

- [ ] Implementation matches the spec in `03_SPECS/`
- [ ] All changed/created files listed in acceptance report
- [ ] Evidence bundle exists at `evidence/block-X/phase-XX/`
- [ ] Evidence bundle contains required evidence types for this phase type
- [ ] Truth matrix row updated (Status changed from Planned)
- [ ] No open Critical or High defects against this phase
- [ ] Phase tracker CSV updated
- [ ] Owner verdict: PASS
- [ ] Confirmer verdict: PASS (evidence independently verified)
- [ ] Challenger verdict: PASS (critical path not breakable)
- [ ] Run ledger entry created

### Additional Gates by Phase Type

#### Schema/Data Model Phase

- [ ] TypeScript interface/type exists
- [ ] YAML/JSON schema validated
- [ ] At least 3 unit tests

#### UI Component Phase

- [ ] Component renders without errors
- [ ] Screenshot in evidence bundle
- [ ] Accessibility check (keyboard nav, contrast)
- [ ] Dark theme verified

#### Integration Phase

- [ ] End-to-end flow tested
- [ ] Error/failure paths tested
- [ ] Performance within acceptable range
- [ ] No regressions in existing tests

#### API/Service Phase

- [ ] Request/response shapes match spec
- [ ] Error codes implemented
- [ ] Timeout/retry behavior verified
- [ ] Auth flow verified

## Block Completion Gate

A block (A through I) can only be marked complete when:

- ALL phases in the block pass their individual gates
- Cross-block dependencies verified
- Block-level integration test passes
- No open defects with severity >= High

## Hard-Stop Triggers

Work must IMMEDIATELY halt if any of the following occur:

| Trigger | Detection Method | Required Action |
|---------|-----------------|-----------------|
| Docs and runtime disagree | Drift scan (parity_check.py) | Stop, fix drift, re-verify |
| Provider routing inexplicable | routing_validator.py fails | Stop, trace route, fix |
| Approval path bypassed | Governance audit | Stop, investigate, tribunal |
| ZeroClaw scope exceeded | Workspace audit | Stop, revoke, patch policy |
| Memory false positive | truth_validator.py | Stop, invalidate cache, fix |
| Training job claim without proof | Evidence check | Stop, require real job logs |
| Release without rollback | Release checklist | Block release |
| Security vulnerability | bandit/security scan | Stop, patch, re-audit |
| Data loss risk | Backup verification | Stop, verify backups, patch |

## Gate Override Protocol

Only the Release Judge can override a gate, and only with:

- Written justification
- Time-limited waiver (max 48 hours)
- Defect filed for the waived item
- Conditional PASS (not full PASS)

## Automated Gate Checks

| Check | Script | When to Run |
|-------|--------|-------------|
| File parity | parity_check.py | Before any phase sign-off |
| Truth validation | truth_validator.py | Before any phase sign-off |
| Routing validation | routing_validator.py | Before Block F sign-off |
| Lint | eslint | Before any code phase |
| Tests | bun test | Before any code phase |
| Build | node esbuild.js | Before any UI phase |
