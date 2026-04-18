# Operator Runbook

> **Purpose:** Step-by-step guide for executing the KiloCode v4 72-phase plan. This runbook
> covers the full daily cycle from picking a phase to closing it, including evidence collection,
> validation, escalation, and common troubleshooting.

---

## 1. Prerequisites

### Required Tools

| Tool | Minimum Version | Purpose | Install |
|------|----------------|---------|---------|
| git | 2.40+ | Version control, branch management | `https://git-scm.com/` |
| gh | 2.40+ | GitHub CLI for PRs, issues, releases | `gh auth login` after install |
| python3 | 3.10+ | Validation scripts (`07_SCRIPTS/`) | System package manager |
| bun | 1.0+ | Build, test, and run TypeScript | `curl -fsSL https://bun.sh/install \| bash` |
| VS Code | 1.85+ | Development environment, extension host | `https://code.visualstudio.com/` |
| lizard | 1.17+ | Cyclomatic complexity analysis | `pip install lizard` |
| bandit | 1.7+ | Python security linter | `pip install bandit` |

### Environment Setup

1. Clone the repository and ensure you are on the correct branch:
   ```bash
   git clone <repo-url> && cd kilocode
   git checkout feat/v4-execution
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Verify your environment passes the parity check:
   ```bash
   python3 docs/kilocode_v4_kit/07_SCRIPTS/parity_check.py
   ```
   Expected output -- all tools found, verdict PASS:
   ```json
   {
     "tools": { "git": true, "gh": true, "lizard": true, "bandit": true },
     "env": { "PATH": true },
     "paths": {},
     "verdict": "PASS"
   }
   ```

4. Verify truth files exist:
   ```bash
   cd docs/kilocode_v4_kit && python3 07_SCRIPTS/truth_validator.py
   ```
   Expected output:
   ```json
   {
     "missing": [],
     "verdict": "PASS"
   }
   ```

### Config Files to Create

| File | Purpose | Template |
|------|---------|----------|
| `.env.local` | Local environment overrides (API keys, endpoints) | Copy from `.env.example` |
| `ssh-profiles.yaml` | SSH connection profiles (for SSH/VPS phases) | See `03_SPECS/KILOCODE_SSH_VPS_COMPLETE_SPEC.md` |
| `provider-config.yaml` | Provider routing overrides (for Routing phases) | See `03_SPECS/KILOCODE_PROVIDER_ROUTING_COMPLETE_SPEC.md` |

---

## 2. Recommended Execution Model

The 24-agent triad model (see `01_MASTER/KILOCODE_V4_20_AGENT_TRIAD_MAP.md`) assigns three
roles per subsystem. In practice, each role maps to a specific tool or workflow:

| Role | Tool / Agent | Responsibility |
|------|-------------|----------------|
| **Program Director** | Claude (master contract driver) | Overall execution, tie-breaking, schedule authority |
| **Release Judge** | Claude | Final pass/fail on every release gate |
| **Evidence Steward** | Claude | Maintains truth matrix, defect ledger, evidence bundles |
| **Subsystem Owner** | Execution agent (Claude Code, Cursor, or human) | Implements phases, writes code, collects initial evidence |
| **Subsystem Confirmer** | Execution agent (independent session) | Reproduces results, verifies config/runtime paths, checks for drift |
| **Subsystem Challenger** | Execution agent (adversarial session) | Attempts to break the implementation, finds edge cases and security issues |
| **Hermes** | Hermes agent | Routing, memory, policy enforcement, ledger updates |
| **ZeroClaw** | ZeroClaw sandbox | Sandboxed execution of untrusted or high-risk tasks |
| **KiloCode** | VS Code extension (cockpit) | Review surface, approval UI, evidence viewer |

### Execution Rules

- No subsystem passes on owner sign-off alone. All three triad members must verdict.
- The owner cannot also serve as confirmer or challenger for the same phase.
- Challenger sessions should run in a clean environment to avoid contamination from owner work.
- Evidence must be collected by the owner but independently verified by the confirmer.

---

## 3. Daily Cycle

Execute these steps each working day. Each step includes the actual commands and expected outputs.

### Step 1: Pick Next Unlocked Phase

Check the phase tracker for the next phase with status "Planned" and no blocking dependencies:

```bash
# View current phase status
cat docs/kilocode_v4_kit/08_TRACKERS/PHASE_TRACKER.csv | head -5

# Find first planned phase
grep ",Planned," docs/kilocode_v4_kit/08_TRACKERS/PHASE_TRACKER.csv | head -1
```

Expected output (example):
```
01,A,Establish source-of-truth files,,,,Planned,,
```

Before starting, confirm no blocking defects exist for this phase:
```bash
grep "Critical\|High" docs/kilocode_v4_kit/02_TRUTH/DEFECT_LEDGER.md
```

### Step 2: Run Owner Implementation

1. Read the relevant spec from `03_SPECS/`:
   ```bash
   # Example for SSH phases
   cat docs/kilocode_v4_kit/03_SPECS/KILOCODE_SSH_VPS_COMPLETE_SPEC.md
   ```

2. Create a branch for this phase:
   ```bash
   git checkout -b phase/XX-short-description
   ```

3. Implement the phase requirements. Write code, tests, and config as specified.

4. Run tests locally:
   ```bash
   bun test
   ```

5. Expected output -- all tests pass:
   ```
   bun test v1.x.x
   ✓ suite-name > test-name
   Tests: X passed, X total
   ```

### Step 3: Collect Evidence

Gather all evidence before requesting verification. See Section 5 for the full evidence
collection guide.

```bash
# Create evidence directory for this phase
mkdir -p evidence/phase-XX

# Capture test output
bun test 2>&1 | tee evidence/phase-XX/test-run-$(date +%Y-%m-%d).log

# Capture complexity analysis
lizard src/ -l python -l typescript > evidence/phase-XX/complexity-report.txt

# Capture security scan (for Python code)
bandit -r src/ -f json > evidence/phase-XX/security-scan.json 2>&1 || true

# Take screenshots of UI changes (manual step -- save to evidence/phase-XX/)
```

### Step 4: Run Confirmer Verification

The confirmer must work independently, without access to the owner's session. They:

1. Pull the branch and read the Acceptance Report:
   ```bash
   git pull && git checkout phase/XX-short-description
   cat evidence/phase-XX/ACCEPTANCE_REPORT.md
   ```

2. Reproduce the claimed functionality:
   ```bash
   bun test
   # Manually verify config/runtime paths described in the report
   ```

3. Check for drift from spec:
   ```bash
   # Compare implementation against spec
   # Verify every claim in the Acceptance Report matches reality
   ```

4. Record verdict in the Acceptance Report (Confirmer Verdict section).

### Step 5: Run Challenger Attack

The challenger operates adversarially. They:

1. Review the implementation for weaknesses:
   ```bash
   git diff main...phase/XX-short-description
   ```

2. Attempt to break critical paths -- invalid inputs, resource exhaustion, auth bypass, race
   conditions, malformed data.

3. Test edge cases the owner may have missed.

4. File defects for any breakage found:
   ```bash
   # Add to defect ledger
   # Format: | D-XXX | Phase | Severity | Symptom | Root Cause | Repro | Status | Evidence | Owner |
   ```

5. Record verdict in the Acceptance Report (Challenger Verdict section).

### Step 6: Update Truth Matrix and Defect Ledger

After all three verdicts are recorded:

```bash
# Update the feature truth matrix
# File: docs/kilocode_v4_kit/02_TRUTH/FEATURE_TRUTH_MATRIX.md
# Set the phase row status to match the gate result

# Update the defect ledger with any new defects
# File: docs/kilocode_v4_kit/02_TRUTH/DEFECT_LEDGER.md

# Update the phase tracker
# File: docs/kilocode_v4_kit/08_TRACKERS/PHASE_TRACKER.csv
# Set Status to Complete, InProgress, or Blocked
```

### Step 7: Pass or Reopen Phase

- If Final Gate Result is **PASS**: merge the branch, update tracker to "Complete".
  ```bash
  git checkout main && git merge phase/XX-short-description
  # Update PHASE_TRACKER.csv status to "Complete"
  ```

- If Final Gate Result is **CONDITIONAL PASS**: merge with conditions documented. Track
  conditions as follow-up tasks.

- If Final Gate Result is **FAIL**: reopen the phase. Do NOT merge.
  ```bash
  # Update PHASE_TRACKER.csv status to "Blocked" or "InProgress"
  # Address defects and re-run from Step 2
  ```

---

## 4. Phase Execution Procedure

Detailed step-by-step for executing a single phase from start to finish.

### 4.1 Read the Spec

1. Identify the spec file for the subsystem:
   ```
   03_SPECS/KILOCODE_SSH_VPS_COMPLETE_SPEC.md        -- Phases 17-34
   03_SPECS/KILOCODE_ZEROCLAW_COMPLETE_SPEC.md        -- Phases 35-44
   03_SPECS/KILOCODE_PROVIDER_ROUTING_COMPLETE_SPEC.md -- Phases 45-52
   03_SPECS/KILOCODE_MEMORY_COMPLETE_SPEC.md          -- Phases 53-58
   03_SPECS/KILOCODE_TRAINING_GPU_COMPLETE_SPEC.md    -- Phases 59-66
   03_SPECS/KILOCODE_GOVERNANCE_RELEASE_COMPLETE_SPEC.md -- Phases 67-72
   ```

2. Find the section for your specific phase number.

3. Note every requirement, schema, and constraint. These become your implementation checklist.

### 4.2 Implement

1. Write the code to satisfy every requirement in the spec.
2. Write unit tests for every public function.
3. Write failure-path tests for every error scenario listed in the spec.
4. Update any config files or schemas as required.

### 4.3 Collect Evidence

See Section 5 below for the full guide. At minimum you need:
- Test run log showing all tests pass
- Screenshots of any UI changes
- Config samples showing correct schema

### 4.4 Run Validation Scripts

```bash
cd docs/kilocode_v4_kit

# 1. Parity check -- verifies tools and environment
python3 07_SCRIPTS/parity_check.py

# 2. Truth validator -- verifies truth files exist
python3 07_SCRIPTS/truth_validator.py

# 3. Routing validator -- verifies provider routing table
python3 07_SCRIPTS/routing_validator.py
```

All three must output `"verdict": "PASS"`.

### 4.5 Fill Acceptance Report

1. Copy the template:
   ```bash
   cp docs/kilocode_v4_kit/04_ENFORCEMENT/ACCEPTANCE_REPORT_TEMPLATE.md \
      evidence/phase-XX/ACCEPTANCE_REPORT.md
   ```

2. Fill every section. Do not leave any field blank.

3. Complete the Owner Verdict section with your assessment.

### 4.6 Submit for Review

1. Commit all changes including the evidence directory:
   ```bash
   git add -A && git commit -m "phase XX: <short description>"
   ```

2. Push and create a PR:
   ```bash
   git push -u origin phase/XX-short-description
   gh pr create --title "Phase XX: <title>" --body "Acceptance report: evidence/phase-XX/ACCEPTANCE_REPORT.md"
   ```

3. Assign the confirmer and challenger for review.

---

## 5. Evidence Collection Guide

### What Counts as Evidence

| Evidence Type | When Required | Format | Example |
|--------------|---------------|--------|---------|
| Test run log | Every phase | `.log` or `.txt` | Full stdout/stderr from `bun test` |
| Screenshot | Any UI change | `.png` | Browser or VS Code screenshot |
| Config sample | Any new config/schema | `.yaml`, `.json`, `.toml` | Working config that exercises the feature |
| Session transcript | End-to-end workflows | `.md` | Step-by-step record of user actions and system responses |
| Coverage report | Phases with new code | `.txt` or `.html` | Output of coverage tool |
| Security scan | Phases touching auth, network, or secrets | `.json` or `.txt` | Output of bandit or equivalent |
| Complexity report | Phases with significant new code | `.txt` | Output of lizard |
| Error log | Failure-path tests | `.log` | Captured error output proving failure paths work |

### Where to Store Evidence

```
evidence/
  phase-01/
    ACCEPTANCE_REPORT.md
    test-run-2026-04-15.log
    coverage-summary.txt
    ...
  phase-02/
    ...
  release-v4.0.0/
    acceptance-reports/
    screenshots/
    test-logs/
    truth-matrix-snapshot.md
    defect-ledger-snapshot.md
```

### Naming Conventions

- Test logs: `test-run-YYYY-MM-DD.log`
- Screenshots: `<feature>-<state>.png` (e.g., `ssh-connect-success.png`, `key-import-error.png`)
- Config samples: `<feature>-sample.<ext>` (e.g., `ssh-profile-sample.yaml`)
- Transcripts: `e2e-<workflow>-transcript.md` (e.g., `e2e-connect-transcript.md`)
- Security scans: `security-scan.json`
- Complexity reports: `complexity-report.txt`

### Evidence Integrity Rules

- Evidence must be generated from the same commit that the Acceptance Report references.
- Screenshots must include timestamps or version info visible in the UI.
- Test logs must be unedited raw output (do not trim failures).
- Config samples must be functional -- they must actually work when loaded.
- The Evidence Steward may reject evidence that appears fabricated or edited.

---

## 6. Escalation Procedures

### When to Trigger a Tribunal

A Defect Tribunal (see `01_MASTER/DEFECT_TRIBUNAL_SYSTEM.md`) is mandatory when:

| Condition | Action |
|-----------|--------|
| A defect reopens more than once | File tribunal request immediately |
| Owner and challenger disagree on severity or verdict | File tribunal request within 24 hours |
| Evidence is ambiguous or contested | File tribunal request within 24 hours |
| A phase claims PASS while a Critical defect remains open | Automatic tribunal -- Evidence Steward initiates |
| A CONDITIONAL PASS condition is not met by its deadline | Automatic tribunal -- Program Director initiates |

### Escalation Timeline

| Severity | Tribunal Convened Within | Members Required |
|----------|------------------------|-----------------|
| Critical | 24 hours of report | Program Director, subsystem owner, subsystem challenger, Evidence Steward, Release Judge |
| High | 48 hours of report | Program Director, subsystem owner, subsystem challenger, Evidence Steward |
| Medium | Next scheduled review cycle | Subsystem owner, subsystem confirmer |
| Low | Batched with phase completion review | Subsystem owner |

### How to File a Critical Defect

1. Add the defect to the Defect Ledger:
   ```
   File: docs/kilocode_v4_kit/02_TRUTH/DEFECT_LEDGER.md

   | D-XXX | Phase | Critical | Symptom | Root Cause | Repro steps | Open | evidence/path | Owner |
   ```

2. Update the phase tracker to "Blocked":
   ```
   File: docs/kilocode_v4_kit/08_TRACKERS/PHASE_TRACKER.csv
   ```

3. Notify the Program Director and Release Judge directly.

4. Include reproduction steps and evidence path in the defect entry.

### Tribunal Outcomes

| Outcome | Effect |
|---------|--------|
| Reopen phase | Phase status set to "InProgress", owner must re-implement |
| Accept with conditions | Phase status set to "Conditional", conditions tracked as follow-ups |
| Accept with waiver | Phase passes with documented exception (rare, requires Release Judge approval) |
| Reject as incomplete | Phase status set to "Blocked", owner must restart from spec review |

---

## 7. Common Issues

| Problem | Symptom | Solution |
|---------|---------|----------|
| Drift detected | `parity_check.py` reports missing tool | Install the missing tool, re-run check |
| Drift detected | `truth_validator.py` reports missing file | Create the missing truth file from template, populate with current state |
| Evidence missing | Acceptance Report references files that do not exist | Regenerate evidence from the current commit, do not fabricate |
| Challenger disagrees with PASS | Challenger filed defects but owner marked PASS | Revert owner verdict, address defects, then re-verdict. If disagreement persists, trigger tribunal |
| Phase blocked by dependency | Phase requires output from an incomplete earlier phase | Check phase tracker for dependency chain. Complete prerequisite phases first. Document the block in the tracker |
| Tests pass locally but fail in CI | Environment difference between local and CI | Run `parity_check.py` in both environments, compare output. Align tool versions |
| Config sample does not load | Schema validation error on sample config | Validate sample against the schema defined in the spec. Fix schema or sample |
| Routing validator shows wrong provider | `routing_validator.py` maps task to unexpected provider | Check `03_SPECS/KILOCODE_PROVIDER_ROUTING_COMPLETE_SPEC.md` for the correct routing table. Update provider config |
| Truth matrix row missing | Phase complete but no row in feature truth matrix | Add the row immediately. A missing row means the phase auto-fails per NO_FAKE_COMPLETION rules |
| Defect ledger not updated | Defects found but not logged | Add all defects to ledger before recording any verdict. Unlogged defects are a process violation |
| Merge conflict on truth files | Multiple phases editing truth matrix or defect ledger simultaneously | Rebase onto main, resolve conflicts conservatively (keep all entries), re-run validators |
| Acceptance Report left partially blank | Owner submitted report with empty sections | Reject the report. Every section must be filled -- use "None" or "N/A" where a section does not apply |

---

## 8. Validation Commands

### parity_check.py

Verifies that all required tools are installed and environment variables are set.

```bash
cd docs/kilocode_v4_kit
python3 07_SCRIPTS/parity_check.py
```

**Pass output:**
```json
{
  "tools": {
    "git": true,
    "gh": true,
    "lizard": true,
    "bandit": true
  },
  "env": {
    "PATH": true
  },
  "paths": {},
  "verdict": "PASS"
}
```

**Fail output (example -- lizard not installed):**
```json
{
  "tools": {
    "git": true,
    "gh": true,
    "lizard": false,
    "bandit": true
  },
  "env": {
    "PATH": true
  },
  "paths": {},
  "verdict": "FAIL"
}
```

**Fix:** Install the missing tool (`pip install lizard`) and re-run.

---

### truth_validator.py

Verifies that all required truth files exist in the repository.

```bash
cd docs/kilocode_v4_kit
python3 07_SCRIPTS/truth_validator.py
```

**Pass output:**
```json
{
  "missing": [],
  "verdict": "PASS"
}
```

**Fail output (example -- defect ledger missing):**
```json
{
  "missing": [
    "02_TRUTH/DEFECT_LEDGER.md"
  ],
  "verdict": "FAIL"
}
```

**Fix:** Create the missing file from its template or restore it from git history.

**Note:** This script checks for these required files:
- `02_TRUTH/KILOCODE_RUNTIME_SOURCE_OF_TRUTH.md`
- `02_TRUTH/FEATURE_TRUTH_MATRIX.md`
- `02_TRUTH/DEFECT_LEDGER.md`

---

### routing_validator.py

Verifies that the provider routing table maps task types to the correct providers.

```bash
cd docs/kilocode_v4_kit
python3 07_SCRIPTS/routing_validator.py
```

**Expected output:**
```
contract_write -> expected claude
execution_worker -> expected minimax
fallback_case -> expected siliconflow
local_private_helper -> expected ollama
```

**How to read this output:** Each line shows a task type and the provider it should route to.
Compare against the routing spec in `03_SPECS/KILOCODE_PROVIDER_ROUTING_COMPLETE_SPEC.md`.
If any mapping is wrong, update the provider configuration and re-run.

**Note:** This script currently prints the expected routing table for manual verification.
It does not yet auto-validate against a live configuration. Treat any mismatch between this
output and your actual routing config as a failure.

---

### Running All Validators Together

```bash
cd docs/kilocode_v4_kit
echo "=== Parity Check ===" && python3 07_SCRIPTS/parity_check.py && \
echo "=== Truth Validator ===" && python3 07_SCRIPTS/truth_validator.py && \
echo "=== Routing Validator ===" && python3 07_SCRIPTS/routing_validator.py
```

All three must pass before any phase can be closed or any release can be authorized.
