# Acceptance Report

> **Instructions:** Copy this template into `evidence/phase-XX/ACCEPTANCE_REPORT.md` for each
> phase (or group of phases) under review. Fill every section. Leave nothing blank -- write
> "None" or "N/A" where a section truly does not apply. The three-verdict gate at the bottom
> must all read PASS (or CONDITIONAL with documented conditions) for the phase to close.

---

## Phase(s)
<!-- Phase number(s) covered by this report, e.g. "Phase 17-19 (SSH Profile, Host Groups, Key Management)" -->
<!-- If a single report covers multiple phases, list each phase number and its title. -->

**Example:**
> Phase 17-19 (SSH Profile Schema, Host Groups & Labels, Key Management & Validation)

---

## Subsystem
<!-- The subsystem this phase belongs to. Must match one of the canonical subsystem names. -->
<!-- Valid values: SSH/VPS, ZeroClaw, Provider Routing, Memory, Training/GPU, Governance, Architecture -->

**Example:**
> SSH/VPS

---

## Claim
<!-- One-sentence summary of what was implemented in this phase. Be specific -- this is the -->
<!-- statement the confirmer and challenger will attempt to verify or disprove. -->

**Example:**
> SSH profile CRUD with key and password auth, including jump-host proxy support and automatic
> host-key fingerprint validation on first connect.

---

## Changed Files
<!-- Every file created or modified as part of this phase. Omit nothing. -->
<!-- Change Type must be one of: Created, Modified, Deleted, Renamed -->

| File | Change Type | Description |
|------|-------------|-------------|
| `src/ssh/profile-store.ts` | Created | Profile persistence with JSON schema validation |
| `src/ssh/key-manager.ts` | Created | SSH key loading, passphrase prompt, agent forwarding |
| `src/ssh/jump-host.ts` | Created | ProxyJump chain resolution and tunnel setup |
| `src/ssh/types.ts` | Modified | Added `SshProfile`, `HostGroup`, `KeyValidation` types |
| `tests/ssh/profile-store.test.ts` | Created | Unit tests for profile CRUD operations |
| `webview-ui/src/components/SshPanel.tsx` | Modified | Connected profile list to new store |

---

## Evidence
<!-- Links or paths to evidence proving the implementation works as claimed. -->
<!-- Every claim must have at least one piece of evidence. Acceptable evidence types: -->
<!--   - Screenshots showing UI state or terminal output -->
<!--   - Test run logs (full stdout/stderr) -->
<!--   - Config samples demonstrating correct schema -->
<!--   - Session transcripts showing end-to-end workflow -->
<!--   - Code coverage reports -->
<!-- Store all evidence under evidence/phase-XX/ using descriptive filenames. -->

- Screenshot: `evidence/phase-17/ssh-connect-success.png`
- Screenshot: `evidence/phase-17/ssh-key-select-dialog.png`
- Test log: `evidence/phase-17/test-run-2026-04-15.log`
- Config sample: `evidence/phase-17/ssh-profile-sample.yaml`
- Coverage report: `evidence/phase-17/coverage-summary.txt`
- Session transcript: `evidence/phase-17/e2e-connect-transcript.md`

---

## Failure-Path Tests
<!-- What failure and edge-case scenarios were tested? Every subsystem must test at least: -->
<!--   - Invalid input / malformed data -->
<!--   - Resource unavailable / timeout -->
<!--   - Permission denied / auth failure -->
<!--   - Concurrent access / race condition (where applicable) -->
<!-- Fill "Actual Result" and "Pass?" during testing. Leave blank only if test is pending. -->

| Scenario | Expected Result | Actual Result | Pass? |
|----------|----------------|---------------|-------|
| Invalid SSH key format | Error `SSH_KEY_INVALID` shown, profile not saved | | |
| Host unreachable | Timeout after 30s, retry prompt with backoff options | | |
| Wrong passphrase (3 attempts) | Lock out after 3 failures, log `AUTH_EXHAUSTED` | | |
| Key file missing from disk | Error `KEY_FILE_NOT_FOUND`, suggest re-import | | |
| Duplicate profile name | Reject with `PROFILE_NAME_CONFLICT`, no overwrite | | |
| Jump-host chain > 3 hops | Warn user, allow with explicit confirmation | | |
| Concurrent profile edit | Last-write-wins with conflict notification | | |

---

## Open Defects
<!-- Any defects found during this phase that remain unresolved. -->
<!-- Reference defect IDs from the Defect Ledger (02_TRUTH/DEFECT_LEDGER.md). -->
<!-- If no defects, write "None". Do NOT leave this section empty. -->

| Defect ID | Severity | Description | Blocking? |
|-----------|----------|-------------|-----------|
| D-XXX | Medium | Key agent forwarding fails on Windows when ssh-agent service is stopped | No |
| None | | | |

---

## Owner Verdict

The subsystem owner completes this section after implementation and self-testing.

- [ ] Implementation complete -- all code written and compiling
- [ ] Evidence collected -- all items listed in Evidence section exist and are current
- [ ] Failure paths tested -- all rows in Failure-Path Tests table have results
- [ ] Truth matrix updated -- `02_TRUTH/FEATURE_TRUTH_MATRIX.md` row matches reality
- [ ] No drift -- `parity_check.py` and `truth_validator.py` both pass

**Verdict:** PASS / FAIL / CONDITIONAL

**Notes:**
<!-- If CONDITIONAL, list the exact conditions that must be met before this can become PASS. -->
<!-- If FAIL, describe what is missing or broken. -->

---

## Confirmer Verdict

The subsystem confirmer completes this section after independent verification.
The confirmer must NOT rely on the owner's evidence alone -- they must reproduce key results.

- [ ] Evidence verified independently -- confirmer ran tests and checked outputs firsthand
- [ ] Config/runtime paths confirmed -- feature is reachable through the documented path
- [ ] No drift from spec -- implementation matches the spec in `03_SPECS/`
- [ ] Truth matrix row accurate -- the feature status in the truth matrix is correct
- [ ] Defect ledger current -- all known issues are logged with correct severity

**Verdict:** PASS / FAIL / CONDITIONAL

**Notes:**
<!-- Describe what was verified and how. If FAIL, list specific discrepancies found. -->

---

## Challenger Verdict

The subsystem challenger completes this section after attempting to break the implementation.
The challenger's job is adversarial: find bugs, edge cases, security issues, and drift.

- [ ] Attempted to break critical path -- tried at least 3 distinct attack vectors
- [ ] Edge cases tested -- boundary values, empty inputs, maximum sizes, Unicode, etc.
- [ ] Security implications reviewed -- auth bypass, injection, privilege escalation, data leak
- [ ] Resource limits tested -- memory, disk, CPU, network under constrained conditions
- [ ] Error messages reviewed -- no stack traces leaked to user, no sensitive data in logs

**Verdict:** PASS / FAIL / CONDITIONAL

**Notes:**
<!-- Describe what attacks were attempted and their outcomes. -->
<!-- If FAIL, each finding must have a corresponding defect ID in the Defect Ledger. -->

---

## Final Gate Result

This section is completed by the Evidence Steward after all three verdicts are recorded.

- **Result:** PASS / FAIL / CONDITIONAL PASS
- **Conditions (if any):**
  <!-- List every condition from CONDITIONAL verdicts above. Each must have an owner and deadline. -->
- **Open defect count:** 0 Critical, 0 High, 0 Medium, 0 Low
- **Blocking defects:** None
- **Date:**
- **Sign-off:**
  - Owner: _______________
  - Confirmer: _______________
  - Challenger: _______________
  - Evidence Steward: _______________

---

> **Gate Rules (from NO_FAKE_COMPLETION_AND_NO_DRIFT_RULES.md):**
> - A phase automatically FAILS if docs claim it exists but the runtime path is absent.
> - A phase automatically FAILS if only the happy path is tested.
> - A phase automatically FAILS if the evidence bundle is missing.
> - A phase automatically FAILS if the truth matrix row is missing.
> - A phase automatically FAILS if the challenger found critical breakage.
> - All three verdicts (Owner, Confirmer, Challenger) must be PASS or CONDITIONAL for the
>   Final Gate Result to be anything other than FAIL.
