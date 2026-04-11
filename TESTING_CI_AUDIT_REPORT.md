# Testing & CI/CD Audit Report — Devil Code (Kilo Code)

**Audit Date:** 2026-04-10  
**Auditor:** Testing Workflow Optimizer Agent  
**Scope:** `packages/opencode/` (Core CLI), `.github/workflows/`, test configuration  

---

## Executive Summary

This audit identified **21 distinct issues** across testing infrastructure, CI/CD pipelines, and test quality. The monorepo shows signs of rapid development with gaps in E2E coverage, numerous test mocks that don't verify actual implementations, and configuration drift between CI and local environments.

**Critical Issues:** 1  
**High Severity:** 5  
**Medium Severity:** 9  
**Low Severity:** 6  

---

## 1. SKIPPED/DISABLED TESTS

### Issue #1: Permanently Skipped Unicode Test
**Severity:** MEDIUM  
**File:** `packages/opencode/test/snapshot/snapshot.test.ts:333`  
**Issue:** Test explicitly skipped with `test.skip()` for "unicode filenames modification and restore"  
**What's Broken:** Unicode filename handling is not being tested; potential encoding issues in file operations remain unverified  
**Remediation:** Enable test or document why unicode support is not required; add Jira/Linear ticket reference

---

## 2. FLAKY TEST INDICATORS

### Issue #2: Timing-Dependent Process Tests
**Severity:** MEDIUM  
**Files:** `packages/opencode/test/util/process.test.ts:33-51`  
**Issue:** Tests use `setTimeout()` for abort signal timing (25ms delays) which can fail on slow CI runners  
**What's Broken:** `SIGTERM fallback when process ignores signal` and `Process can be aborted` tests rely on precise timing  
**Remediation:** Replace fixed timeouts with polling or use `Bun.sleep(0)` to yield to event loop; add retry logic

### Issue #3: Lock Test Uses Arbitrary Delays
**Severity:** LOW  
**File:** `packages/opencode/test/util/lock.test.ts:9-67`  
**Issue:** `tick()` function with `n` iterations used to simulate async timing  
**What's Broken:** Non-deterministic test ordering could hide real race conditions  
**Remediation:** Replace `tick()` with explicit Promise resolution or `Bun.sleep(0)`

### Issue #4: Timeout Tests Have Narrow Margins
**Severity:** LOW  
**File:** `packages/opencode/test/util/timeout.test.ts:7-19`  
**Issue:** Tests use 10ms/50ms/100ms/200ms timeouts that may flake on overloaded CI  
**What's Broken:** 10ms promise vs 100ms timeout has insufficient margin for CI jitter  
**Remediation:** Increase timeout margins to 10x ratio (e.g., 50ms vs 500ms) or mock timer APIs

---

## 3. MOCK OVERUSE / NOT TESTING ACTUAL IMPLEMENTATION

### Issue #5: Build Runner Tests Mock Core Dependencies
**Severity:** HIGH  
**File:** `packages/opencode/test/kilocode/workflow/build-runner.test.ts:1-200`  
**Issue:** Nearly entire module is mocked—Session, Worktree, Instance, Bus—all critical dependencies mocked  
**What's Broken:** Test validates mock behavior, not actual workflow execution; no integration with real worktree creation  
**Code Example:**
```typescript
mock.module("@/session", () => ({
  Session: { create: mockSessionCreate }
}))
mock.module("@/worktree", () => ({
  Worktree: { create: mockWorktreeCreate }
}))
```
**Remediation:** Create integration test suite that uses real worktrees in temp directories; reserve mocks for LLM/API calls only

### Issue #6: E2E Tests Use Mocked Sessions
**Severity:** CRITICAL  
**File:** `packages/opencode/test/kilocode/e2e/workflow-state.e2e.test.ts:1-100`  
**Issue:** E2E tests mock `Session.create`, `SessionPrompt.prompt`, and worktree operations  
**What's Broken:** These are labeled "e2e" but test only mock interactions—no actual end-to-end validation  
**Remediation:** Rename to `workflow-state.unit.test.ts` or implement true E2E with real session lifecycle

### Issue #7: Session Bridge Tests Mock Session Layer
**Severity:** HIGH  
**File:** `packages/opencode/test/kilocode/workflow/session-bridge.test.ts`  
**Issue:** Mocks session prompt and worktree despite testing session bridge integration  
**What's Broken:** Session bridge is a critical integration point but tests don't verify real session communication  
**Remediation:** Add integration test with real session in isolated worktree

### Issue #8: Team Workflow Tests Use Mocked Agents
**Severity:** MEDIUM  
**File:** `packages/opencode/test/kilocode/team/workflow-integration.test.ts`  
**Issue:** Team routing and agent coordination tested with mocks, not real agent lifecycle  
**What's Broken:** Complex multi-agent logic may have race conditions not caught by mocks  
**Remediation:** Add containerized or temp-directory integration tests for agent coordination

### Issue #9: Dispatch Tests Mock Core Workflow
**Severity:** MEDIUM  
**File:** `packages/opencode/test/kilocode/workflow/dispatch.test.ts`  
**Issue:** Workflow dispatch tested with mocked state manager and build runner  
**What's Broken:** Dispatch logic may fail with real async state transitions  
**Remediation:** Add tests with real WorkflowStateManager in temp directory

---

## 4. MISSING TEST COVERAGE

### Issue #10: No Tests for Workflow TUI Components
**Severity:** HIGH  
**Files:** `packages/opencode/src/devilcode/workflow-tui/*.tsx` (8 files, ~1,500 LOC)  
**Issue:** Complex TUI components (orchestrator, tabs, panels) have zero test coverage  
**What's Broken:** No automated verification of UI state management, keyboard navigation, or component lifecycle  
**Remediation:** Add component-level tests using `@testing-library` or snapshot tests for TUI output

### Issue #11: Team Router Missing Tests
**Severity:** HIGH  
**File:** `packages/opencode/src/devilcode/team/router.ts` (~300 LOC)  
**Issue:** Critical routing logic for multi-agent teams has no dedicated tests  
**What's Broken:** Hierarchical routing, escalation, and delegation logic untested  
**Remediation:** Add unit tests for `route()`, `escalate()`, and `delegate()` with various team configurations

### Issue #12: Workflow Locks/Mutex Untested
**Severity:** MEDIUM  
**Files:** `packages/opencode/src/devilcode/workflow/locks.ts`, `mutex.ts`  
**Issue:** Concurrency control primitives have no test coverage  
**What's Broken:** Race conditions in multi-wave execution could deadlock or corrupt state  
**Remediation:** Add tests for lock acquisition, release, and deadlock prevention

### Issue #13: Contract Generator Missing Tests
**Severity:** MEDIUM  
**File:** `packages/opencode/src/devilcode/workflow/contract-generator.ts`  
**Issue:** Contract generation for workflow tasks untested  
**What's Broken:** Generated contracts may have schema mismatches  
**Remediation:** Add tests verifying generated contract structure and validation

### Issue #14: No Tests for Error Handling Paths
**Severity:** MEDIUM  
**Issue:** Most tests only verify happy paths; error handling and recovery not tested  
**Evidence:** Build runner tests check "marks task as failed when session throws" but don't test partial wave failure  
**Remediation:** Add systematic error injection tests for all workflow stages

### Issue #15: Agent SDK Bridge Untested
**Severity:** MEDIUM  
**Files:** `packages/opencode/src/devilcode/agent-sdk-bridge.ts`, `agent-sdk.ts`  
**Issue:** Bridge between agent system and SDK has no dedicated tests  
**What's Broken:** SDK compatibility issues may not surface until production  
**Remediation:** Add contract tests for SDK bridge methods

---

## 5. CI/CD CONFIGURATION ISSUES

### Issue #16: Missing Workflow File (GitHub Actions)
**Severity:** MEDIUM  
**File:** `.github/workflows/test.yml` (referenced but inaccessible)  
**Issue:** Cannot verify if test.yml exists or its configuration  
**What's Broken:** Unable to audit CI pipeline for test execution, parallelism, or artifact handling  
**Remediation:** Verify workflow file exists and is tracked in git; provide path for audit

### Issue #17: VS Code Extension Test Isolation
**Severity:** MEDIUM  
**File:** `.github/workflows/test-vscode.yml`  
**Issue:** Extension tests may not isolate from global VS Code state  
**What's Broken:** Test pollution between runs; flaky extension tests  
**Remediation:** Ensure tests use `--user-data-dir` and `--extensions-dir` pointing to temp locations

### Issue #18: No Test Parallelization Configuration
**Severity:** LOW  
**Issue:** Bun test runner not configured for parallel execution  
**What's Broken:** CI test suite runs slower than necessary  
**Evidence:** No `--parallel` or `--workers` flags in package.json scripts  
**Remediation:** Add `bun test --parallel` after verifying test isolation

### Issue #19: Missing Coverage Reporting
**Severity:** MEDIUM  
**Issue:** No code coverage collection in CI  
**What's Broken:** Cannot track coverage regression or identify untested critical paths  
**Remediation:** Add `bun test --coverage` and upload to Codecov or similar service

### Issue #20: No Flaky Test Detection in CI
**Severity:** LOW  
**Issue:** CI runs tests once; no detection of non-deterministic failures  
**What's Broken:** Flaky tests accumulate over time without visibility  
**Remediation:** Add test result tracking or run critical tests 3x and alert on variance

---

## 6. TEST ENVIRONMENT ISSUES

### Issue #21: Test Preload Has Unconditional Migrations
**Severity:** LOW  
**File:** `packages/opencode/test/preload.ts` (observed in bunfig)  
**Issue:** Test environment may run migrations unconditionally  
**What's Broken:** Slow test startup; potential database state pollution  
**Remediation:** Verify migrations only run when needed or use in-memory test database

---

## Test Distribution Analysis

| Category | Count | Coverage Assessment |
|----------|-------|---------------------|
| Unit Tests | ~45 files | Moderate—too many mocks |
| Integration Tests | ~5 files | Poor—mostly mocked |
| E2E Tests | ~2 files | Critical Gap—all mocked |
| **Total Test Files** | **~52** | **Below target for codebase size** |

### Source-to-Test Ratio
- Source files in `packages/opencode/src/`: ~400+ files
- Test files: ~52 files
- **Ratio: ~8:1** (industry standard is 3:1 to 5:1)

### High-Risk Untested Modules
1. `workflow-tui/` — Complex TUI, zero tests
2. `team/router.ts` — Critical routing, no tests
3. `workflow/locks.ts`, `mutex.ts` — Concurrency primitives, no tests
4. `agent-sdk-bridge.ts` — SDK integration, no tests
5. `review/` directory — Review orchestration, minimal tests

---

## Remediation Priority Matrix

| Priority | Issues | Impact | Effort |
|----------|--------|--------|--------|
| **P0 (Now)** | #6 (E2E mocks), #5 (build-runner mocks) | High | Medium |
| **P1 (Sprint)** | #10 (TUI tests), #11 (router tests), #12 (locks tests) | High | High |
| **P2 (Quarter)** | #14 (error paths), #19 (coverage), #15 (SDK bridge) | Medium | Medium |
| **P3 (Backlog)** | #1 (unicode test), #2-4 (timing), #18 (parallel) | Low | Low |

---

## Recommendations

### Immediate (This Week)
1. **Enable or document** the skipped unicode test (#1)
2. **Rename mislabeled E2E tests** or implement true E2E with Docker/temp directories (#6)
3. **Add real integration tests** for build runner with temp worktrees (#5)

### Short-Term (This Month)
4. **Create test plan** for `workflow-tui/` components using TUI testing framework
5. **Add tests** for `team/router.ts` routing logic
6. **Implement coverage tracking** in CI with Codecov integration
7. **Audit all mock-heavy tests** and create integration test backlog

### Long-Term (This Quarter)
8. **Establish E2E test harness** using real sessions in isolated directories
9. **Add concurrency stress tests** for workflow locks and mutex
10. **Implement flaky test detection** with CI alerts
11. **Target 70% coverage** on `devilcode/` directory (currently estimated <30%)

---

## Appendix: File Inventory

### Test Files with Issues
```
packages/opencode/test/
├── snapshot/snapshot.test.ts        # Skipped test (#1)
├── util/process.test.ts             # Timing issues (#2)
├── util/lock.test.ts                # Arbitrary delays (#3)
├── util/timeout.test.ts             # Narrow margins (#4)
├── kilocode/workflow/
│   ├── build-runner.test.ts         # Mock overuse (#5)
│   ├── state.test.ts                # Good: Real file system tests
│   ├── session-bridge.test.ts       # Mock overuse (#7)
│   └── dispatch.test.ts             # Mock overuse (#9)
├── kilocode/e2e/
│   └── workflow-state.e2e.test.ts   # Mislabeled (#6)
└── kilocode/team/
    └── workflow-integration.test.ts # Mock overuse (#8)
```

### Untested Critical Source Files
```
packages/opencode/src/devilcode/
├── workflow-tui/                    # ~1,500 LOC, 0 tests (#10)
│   ├── orchestrator.ts
│   ├── tabs/plan-tab.tsx
│   ├── detail-panel.tsx
│   └── [6 more files]
├── team/router.ts                   # ~300 LOC, 0 tests (#11)
├── workflow/locks.ts                # 0 tests (#12)
├── workflow/mutex.ts                # 0 tests (#12)
├── workflow/contract-generator.ts   # 0 tests (#13)
├── agent-sdk-bridge.ts              # 0 tests (#15)
└── review/*.ts                      # Minimal coverage
```

---

*Report generated by Testing Workflow Optimizer Agent*  
*For questions or remediation support, contact the Testing Infrastructure team.*
