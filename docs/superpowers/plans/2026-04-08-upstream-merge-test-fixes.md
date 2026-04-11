# Upstream Merge Test Failure Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 45 test failures caused by two code-level bugs exposed after merging 286 upstream commits from Kilo-Org/kilocode.

**Architecture:** Two independent root causes: (1) a top-level module evaluation in `remote-sender.ts` that creates a circular dependency race condition during parallel test execution, and (2) a `mock.module()` call in `session-import-service.test.ts` that globally replaces the DB module with an incomplete mock, poisoning all subsequent tests that touch the database. Both are code/test infrastructure bugs, not test assertion issues.

**Tech Stack:** Bun test runner, Zod, drizzle-orm, TypeScript

---

## File Structure

| File | Responsibility | Change Type |
|---|---|---|
| `packages/opencode/src/kilo-sessions/remote-sender.ts` | Remote session protocol sender | Modify: defer top-level schema evaluation |
| `packages/opencode/test/kilocode/session-import-service.test.ts` | Session import DB tests | Modify: isolate mock to prevent cross-test pollution |

Both fixes are independent — they address separate root causes and can be committed in any order.

---

### Task 1: Fix circular dependency race in remote-sender.ts

**Root Cause:** Line 23 of `remote-sender.ts` evaluates `SessionPrompt.PromptInput.extend(...)` at **module load time** (top-level `const`). The session module graph has a circular dependency:

```
session/index.ts → session/prompt.ts → session/processor.ts → session/index.ts
```

When Bun runs tests in parallel, module evaluation order becomes non-deterministic. If `remote-sender.ts` evaluates before `session/prompt.ts` finishes exporting `SessionPrompt`, the access fails with `TypeError: undefined is not an object`. This cascading failure breaks `Session`, `Snapshot.diffFull`, and every test that depends on the session subsystem.

**Fix:** Make the schema lazy — evaluate it on first use instead of at module load time.

**Files:**
- Modify: `packages/opencode/src/kilo-sessions/remote-sender.ts:23-39`

- [ ] **Step 1: Run the failing tests to confirm the failure**

Run from `packages/opencode/`:
```bash
bun test test/kilocode/snapshot-cache.test.ts test/kilocode/session-import-service.test.ts test/kilocode/plan-followup.test.ts
```
Expected: 3 diffFull tests fail with `TypeError: undefined is not an object (evaluating 'result.sandboxes.filter')`

- [ ] **Step 2: Make RemotePromptInput lazy**

In `packages/opencode/src/kilo-sessions/remote-sender.ts`, replace lines 23-39:

```typescript
// BEFORE (lines 23-39):
const RemotePromptInput = SessionPrompt.PromptInput.extend({
  model: z.string().optional(),
})

function normalizeModel(model: z.infer<typeof RemotePromptInput.shape.model>) {
  if (!model) return undefined
  return {
    providerID: "kilo",
    modelID: model.startsWith("devilcode/") ? model.slice("devilcode/".length) : model,
  }
}

function normalizePrompt(input: z.infer<typeof RemotePromptInput>): SessionPrompt.PromptInput {
  return {
    ...input,
    model: normalizeModel(input.model),
  }
}
```

```typescript
// AFTER:
let _remotePromptInput: ReturnType<typeof SessionPrompt.PromptInput.extend> | undefined

function getRemotePromptInput() {
  if (!_remotePromptInput) {
    _remotePromptInput = SessionPrompt.PromptInput.extend({
      model: z.string().optional(),
    })
  }
  return _remotePromptInput
}

function normalizeModel(model: string | undefined) {
  if (!model) return undefined
  return {
    providerID: "kilo",
    modelID: model.startsWith("devilcode/") ? model.slice("devilcode/".length) : model,
  }
}

function normalizePrompt(input: z.infer<ReturnType<typeof getRemotePromptInput>>): SessionPrompt.PromptInput {
  const parsed = getRemotePromptInput().parse(input)
  return {
    ...parsed,
    model: normalizeModel(parsed.model),
  }
}
```

- [ ] **Step 3: Update all call sites that reference RemotePromptInput**

Search `remote-sender.ts` for any other references to `RemotePromptInput` and replace with `getRemotePromptInput()`. The known call site is in the `prompt` handler where the input is parsed:

```typescript
// Find the line that does: RemotePromptInput.parse(...)
// Replace with: getRemotePromptInput().parse(...)
```

- [ ] **Step 4: Run typecheck**

```bash
cd packages/opencode && bun run typecheck
```
Expected: Clean (no errors)

- [ ] **Step 5: Run the previously-failing tests together**

```bash
bun test test/kilocode/snapshot-cache.test.ts test/kilocode/session-import-service.test.ts test/kilocode/plan-followup.test.ts
```
Expected: 24 pass, 0 fail

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/kilo-sessions/remote-sender.ts
git commit -m "fix(cli): defer RemotePromptInput schema to avoid circular dependency race

The top-level const evaluated SessionPrompt.PromptInput.extend() at
module load time, but the session module graph has circular deps.
During parallel test execution, non-deterministic evaluation order
caused undefined access. Lazy initialization breaks the cycle."
```

---

### Task 2: Fix mock.module pollution in session-import-service test

**Root Cause:** `test/kilocode/session-import-service.test.ts` line 6 uses `mock.module("../../src/storage/db", ...)` which **globally replaces** the DB module for the entire test process. The mock only exports `{ Database: { use, close }, eq }`, but the real module also exports `NotFoundError`, `Database.transaction`, and re-exports all of `drizzle-orm`. Any test file that subsequently imports from `storage/db` gets the incomplete mock, causing:

- `SyntaxError: Export named 'NotFoundError' not found`
- `result.sandboxes` being `undefined` (Project.fromDirectory gets broken DB results)

**Fix:** Scope the mock so it doesn't leak. Bun's `mock.module()` is process-global and cannot be unscoped, so the fix is to use `spyOn` on the `Database` object instead, which is per-test and automatically restored.

**Files:**
- Modify: `packages/opencode/test/kilocode/session-import-service.test.ts:1-11`

- [ ] **Step 1: Run session-import test alongside snapshot-cache to confirm pollution**

```bash
bun test test/kilocode/session-import-service.test.ts test/kilocode/snapshot-cache.test.ts
```
Expected: snapshot-cache tests fail due to DB mock pollution

- [ ] **Step 2: Replace mock.module with spyOn approach**

In `packages/opencode/test/kilocode/session-import-service.test.ts`, replace lines 1-11:

```typescript
// BEFORE (lines 1-11):
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

const use = mock((fn: (db: any) => unknown) => fn(db))
const eq = (a: unknown, b: unknown) => ({ a, b })

mock.module("../../src/storage/db", () => ({
  Database: { use, close() {} },
  eq,
}))

const { SessionImportService } = await import("../../src/devilcode/session-import/service")
```

```typescript
// AFTER:
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { SessionImportService } from "../../src/devilcode/session-import/service"

const eq = (a: unknown, b: unknown) => ({ a, b })
```

- [ ] **Step 3: Add beforeEach/afterEach to spy on Database.use**

Add a `beforeEach` block that spies on `Database.use` to intercept DB calls without replacing the module globally:

```typescript
let useSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  useSpy = spyOn(Database, "use").mockImplementation((fn: (db: any) => unknown) => fn(db))
})

afterEach(() => {
  useSpy.mockRestore()
})
```

Note: merge this with any existing `beforeEach`/`afterEach` blocks in the file.

- [ ] **Step 4: Update test assertions that reference the old `use` mock**

Search the test file for references to `use.mock` (the old mock variable) and replace with `useSpy.mock`. Common patterns:
- `use.mockImplementation(...)` → `useSpy.mockImplementation(...)`
- `expect(use).toHaveBeenCalled()` → `expect(useSpy).toHaveBeenCalled()`

If the tests don't directly assert on `use`, this step may be a no-op.

- [ ] **Step 5: Run the test in isolation**

```bash
bun test test/kilocode/session-import-service.test.ts
```
Expected: 2 pass, 0 fail

- [ ] **Step 6: Run combined to confirm no pollution**

```bash
bun test test/kilocode/session-import-service.test.ts test/kilocode/snapshot-cache.test.ts test/kilocode/plan-followup.test.ts
```
Expected: All pass (24 pass, 0 fail)

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/test/kilocode/session-import-service.test.ts
git commit -m "fix(cli): replace global mock.module with spyOn in session-import test

mock.module() globally replaces the DB module for the entire test
process, causing cross-test pollution. Tests that subsequently import
storage/db get an incomplete mock missing NotFoundError and drizzle-orm
re-exports. Using spyOn(Database, 'use') scopes the mock per-test."
```

---

### Task 3: Full regression verification

- [ ] **Step 1: Run the full kilocode test suite**

```bash
cd packages/opencode && bun test test/kilocode/
```
Expected: 614 pass, 0 fail (or close — any remaining failures are unrelated)

- [ ] **Step 2: Run the full CLI test suite**

```bash
cd packages/opencode && bun test
```
Expected: Significant reduction from 581 failures. Many of the 581 were cascade failures from the two root causes above.

- [ ] **Step 3: Run typecheck**

```bash
bun turbo typecheck
```
Expected: 12/12 pass

- [ ] **Step 4: Commit any remaining fixes if needed**

If Task 3 Step 1-2 reveals additional failures, investigate individually. The two fixes above should resolve the majority of the 45 kilocode failures and a large portion of the broader 581 failures.

---

## Why These Are Code Bugs, Not Test Bugs

1. **remote-sender.ts**: Top-level module evaluation of a schema that depends on a circular import chain is a **production code defect**. It works in production only because the CLI's single-threaded startup happens to evaluate modules in the right order. Any change to import order (new import, tree-shaking, bundler change) would cause the same crash in production.

2. **session-import-service.test.ts**: While this is technically a test file, the bug is in the **test infrastructure** — `mock.module()` has process-global scope, which is a Bun limitation the test should work around. The production code (`session-import/service.ts`) is correct; the test's mocking strategy is what's broken.
