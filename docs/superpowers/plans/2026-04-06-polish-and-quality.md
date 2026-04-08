# Polish & Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix pre-existing test failures in the retry-limit test, verify type-check cleanliness, add keyboard navigation to the TUI task panel, and implement tab close functionality -- the final polish gaps (14-17) for the multi-model multiplexing feature.

**Architecture:** Gaps 14-15 are investigation-first debugging tasks in the CLI test and build pipeline. Gaps 16-17 are small TUI enhancements in SolidJS + OpenTUI components, following patterns already established in the workflow-tui codebase. All changes are scoped to `packages/opencode/`.

**Tech Stack:** TypeScript, Bun test runner, `bunx tsgo --noEmit` for type-checking, SolidJS, `@opentui/solid` (useKeyboard), `solid-js/store` (produce).

---

## Task 1: Reproduce and Diagnose Retry-Limit Test Failure (Gap 14)

This is a systematic debugging task. Do NOT change code until the root cause is confirmed.

**Files:**
- Test: `packages/opencode/test/kilocode/session-processor-retry-limit.test.ts`
- Subject: `packages/opencode/src/session/processor.ts`
- Flag: `packages/opencode/src/flag/flag.ts`
- Retry: `packages/opencode/src/session/retry.ts`

### Phase A: Reproduce

- [ ] **Step 1: Run the failing test and record exact output**

```bash
cd packages/opencode && bun test test/kilocode/session-processor-retry-limit.test.ts 2>&1
```

Expected: The first test ("stops after two retries with the normalized retryable error") fails. Record:
- The actual number of `LLM.stream` calls (expected 3, reportedly getting 5)
- The actual number of `SessionRetry.sleep` calls (expected 2)
- The actual `retry` array values (expected `[1, 2]`)
- The exact error message from each `expect()` assertion

If the test passes, mark Gap 14 as resolved and skip to Task 2.

### Phase B: Investigate the execution path

- [ ] **Step 2: Add diagnostic spyOn tracking to confirm call counts**

If the test failed in Step 1, add temporary logging to the test to trace the execution flow. Modify the test to capture call details:

```typescript
// In the test file, after the existing spyOn calls (around line 142),
// add call-tracking wrappers:

const llmCallArgs: number[] = []
const originalLlm = llm
const wrappedLlm = spyOn(LLM, "stream").mockImplementation(async (...args) => {
  llmCallArgs.push(llmCallArgs.length + 1)
  console.log(`[DIAG] LLM.stream call #${llmCallArgs.length}`)
  // Delegate to the original mock chain
  return originalLlm.getMockImplementation()?.(...args) ?? originalLlm(...args)
})
```

Actually, the existing mock chain handles this. Instead, insert console logging around the processor.process call:

```typescript
// Before processor.process call (around line 162), add:
console.log("[DIAG] Flag.DEVIL_SESSION_RETRY_LIMIT =", (await import("../../src/flag/flag")).Flag.DEVIL_SESSION_RETRY_LIMIT)
```

Run the test again with verbose output:

```bash
cd packages/opencode && bun test test/kilocode/session-processor-retry-limit.test.ts --verbose 2>&1
```

Record:
- Whether `Flag.DEVIL_SESSION_RETRY_LIMIT` is `2` or `undefined` at execution time
- How many times `LLM.stream` was actually called
- The sequence of retry attempt numbers

- [ ] **Step 3: Check if `Flag.DEVIL_SESSION_RETRY_LIMIT` is captured correctly**

The `Flag` module uses `number()` which reads `process.env` at **import time** (line 69 of `flag.ts`). The env var is set at the top of the test file before imports. However, `Bun`'s module caching may mean a previously-imported `flag.ts` (from another test or module) has already captured `DEVIL_SESSION_RETRY_LIMIT` as `undefined`.

The test uses dynamic imports (`await import(...)`) for `SessionRetry` and `LLM` which transitively import `flag.ts`. But if `flag.ts` was already loaded by a static import chain, the `number()` call already ran with whatever env was set at that time.

Check if any **static** import in the test file transitively imports `flag.ts`:

```bash
cd packages/opencode && grep -r "from.*flag" src/provider/provider.ts src/session/llm.ts src/session/message-v2.ts src/util/log.ts 2>/dev/null
```

If `flag.ts` is imported by any statically-imported module, the env var set at line 5 will NOT be captured because ES module hoisting means static imports resolve before the `process.env` assignment at line 5 runs.

### Phase C: Root-Cause Determination

- [ ] **Step 4: Determine the root cause and categorize it**

Based on findings from Steps 1-3, determine which category applies:

**Category A: Flag not captured (most likely)**
If `Flag.DEVIL_SESSION_RETRY_LIMIT` is `undefined` at runtime, the retry limit is not enforced, meaning the processor retries indefinitely until `mockRejectedValue(sentinel())` fires. The sentinel throws a non-retryable error, but 4 retryable 429 errors are only mocked for the first 3 calls (via `mockRejectedValueOnce` x3). The 4th call hits `mockRejectedValue(sentinel())`, which is `new Error("unexpected extra llm call")` -- this is NOT an `APICallError`, so `SessionRetry.retryable()` returns `undefined` for it, stopping the loop. But that would be 4 calls, not 5.

If it's 5 calls, there may be a re-invocation from the outer `prompt.ts` loop. But the test calls `processor.process()` directly, not `SessionPrompt.run()`, so the outer loop is not involved.

**Category B: Off-by-one in retry logic**
If the flag IS captured as `2`, trace the exact sequence:
- Call 1: `attempt=0` -> error -> `0 < 2` = true -> `attempt` becomes 1 -> sleep -> continue
- Call 2: `attempt=1` -> error -> `1 < 2` = true -> `attempt` becomes 2 -> sleep -> continue  
- Call 3: `attempt=2` -> error -> `2 < 2` = false -> sets error -> exits loop

This should produce exactly 3 calls and 2 sleeps, matching test expectations.

**Category C: Multiple process() calls or re-entry**
If something causes the while loop to continue past the error-handling block without hitting the retry check.

### Phase D: Apply the Fix

- [ ] **Step 5: Fix based on root cause**

**If Category A (Flag not captured):**

The fix is to ensure the test's dynamic import of `flag.ts` gets a fresh module with the env var set. The test already sets `process.env.DEVIL_SESSION_RETRY_LIMIT = "2"` at line 5 before any imports. The issue is that Bun may have cached the module from another test file.

Option 1: Force a fresh import with a cache-busting query string (the test already does this for the `"only positive integers"` test at line 185 but NOT for the main test):

In `packages/opencode/test/kilocode/session-processor-retry-limit.test.ts`, check if any module imported inside the test at lines 77-83 re-exports or transitively loads `Flag`. If `SessionProcessor` or `LLM` transitively imports `Flag`, and that import is cached, the flag value is stale.

The fix: Modify the `Flag` module's `DEVIL_SESSION_RETRY_LIMIT` to use a dynamic getter (like `DEVIL_DISABLE_PROJECT_CONFIG` at line 75 of `flag.ts`) instead of a static assignment:

```typescript
// In packages/opencode/src/flag/flag.ts
// Replace line 69:
//   export const DEVIL_SESSION_RETRY_LIMIT = number("DEVIL_SESSION_RETRY_LIMIT")
// With a dynamic getter that evaluates at access time:
export declare const DEVIL_SESSION_RETRY_LIMIT: number | undefined
```

Then add the dynamic getter after the namespace (after line 70, before the existing `Object.defineProperty` blocks):

```typescript
// Dynamic getter for DEVIL_SESSION_RETRY_LIMIT
// This must be evaluated at access time, not module load time,
// because tests set this env var after module load
Object.defineProperty(Flag, "DEVIL_SESSION_RETRY_LIMIT", {
  get() {
    const value = process.env["DEVIL_SESSION_RETRY_LIMIT"]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  },
  enumerable: true,
  configurable: false,
})
```

**If Category B (off-by-one):**

Change the comparison in `processor.ts` line 417 from `attempt < Flag.DEVIL_SESSION_RETRY_LIMIT` to `attempt <= Flag.DEVIL_SESSION_RETRY_LIMIT` if the intent is "retry N times" (meaning N retries AFTER the initial attempt, for N+1 total calls). Or adjust the test expectations if the current logic is intentional.

**If Category C (re-entry):**

Trace and document the re-entry path. Fix will depend on findings.

- [ ] **Step 6: Remove diagnostic logging added in Step 2**

Remove any `console.log("[DIAG]...")` statements added during investigation.

- [ ] **Step 7: Run the test and verify it passes**

```bash
cd packages/opencode && bun test test/kilocode/session-processor-retry-limit.test.ts 2>&1
```

Expected output:
```
bun test v1.x.x
packages/opencode/test/kilocode/session-processor-retry-limit.test.ts:
  session processor retry limit
    stops after two retries with the normalized retryable error ... [pass]
    only positive integers enable the limit ... [pass]
    does not change after import ... [pass]

 3 pass
 0 fail
```

- [ ] **Step 8: Run the full kilocode test suite for regression**

```bash
cd packages/opencode && bun test test/kilocode/ 2>&1
```

All tests should pass. Record the count.

- [ ] **Step 9: Commit**

```bash
git add packages/opencode/src/flag/flag.ts packages/opencode/test/kilocode/session-processor-retry-limit.test.ts
git commit -m "fix(cli): resolve retry-limit test failure caused by stale flag capture

The DEVIL_SESSION_RETRY_LIMIT flag was evaluated at module load time via
a const assignment, but tests that set process.env after module caching
would see undefined. Changed to a dynamic getter (matching the pattern
used by DEVIL_DISABLE_PROJECT_CONFIG) so the flag is evaluated at access
time.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

NOTE: The commit message above assumes Category A is the root cause. If the investigation reveals a different cause, adjust the commit message and changed files accordingly.

---

## Task 2: Verify Type-Check Cleanliness (Gap 15)

**Files:**
- No files to modify (verification only, unless errors are found)

- [ ] **Step 1: Run the type checker on the full CLI package**

```bash
cd packages/opencode && bunx tsgo --noEmit 2>&1
```

Expected: Zero errors. Record the output.

- [ ] **Step 2: If errors exist, catalog them**

If there are type errors, create a list with:
- File path and line number
- Error code and message
- Whether it's in a test file (`test/kilocode/`) or source file

- [ ] **Step 3: Fix any type errors in kilocode test files**

If type errors exist in `test/kilocode/*.test.ts` files, fix them. Common fixes:
- Missing type assertions (`as Type`)
- Incorrect mock return types
- Stale property references after upstream changes

For each error, apply the minimal type-safe fix. Do not add `@ts-ignore` or `@ts-expect-error`.

- [ ] **Step 4: Run type checker again to confirm clean**

```bash
cd packages/opencode && bunx tsgo --noEmit 2>&1
```

Expected: Zero errors.

- [ ] **Step 5: Commit if any fixes were made**

```bash
git add -u packages/opencode/test/kilocode/
git commit -m "fix(cli): resolve type errors in kilocode test files

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

If no errors were found, skip this commit and note "Gap 15 verified clean" in the implementation summary.

---

## Task 3: TUI Keyboard Navigation for Task Panel (Gap 16)

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow-tui/task-panel.tsx`

- [ ] **Step 1: Add `useKeyboard` import and build flat task list**

In `packages/opencode/src/devilcode/workflow-tui/task-panel.tsx`, add the `useKeyboard` import and create a computed flat list of task IDs for navigation:

Replace the existing imports and the beginning of the component:

```typescript
// packages/opencode/src/devilcode/workflow-tui/task-panel.tsx
import { For, Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "./context"
import { taskStatusIcon } from "./types"
import { groupByWave } from "../workflow/executor"

export function TaskPanel() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  const waves = createMemo(() => groupByWave(wf.plans))

  const flatTaskIds = createMemo(() => {
    const ids: string[] = []
    for (const [, tasks] of waves()) {
      for (const task of tasks) {
        ids.push(task.id)
      }
    }
    return ids
  })

  useKeyboard((evt) => {
    const ids = flatTaskIds()
    if (ids.length === 0) return
    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      const currentIndex = ids.indexOf(wf.selectedTask ?? "")
      const nextIndex = currentIndex <= 0 ? ids.length - 1 : currentIndex - 1
      wf.selectTask(ids[nextIndex]!)
    }
    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      const currentIndex = ids.indexOf(wf.selectedTask ?? "")
      const nextIndex = currentIndex < 0 || currentIndex >= ids.length - 1 ? 0 : currentIndex + 1
      wf.selectTask(ids[nextIndex]!)
    }
  })

  const completedCount = createMemo(() => {
    const active = wf.state?.activeTasks ?? []
    return active.filter((t) => t.status === "completed").length
  })

  return (
    <box
      flexDirection="column"
      width={32}
      backgroundColor={theme.backgroundPanel}
      paddingTop={1}
      paddingLeft={2}
      paddingRight={1}
    >
      <text fg={theme.primary} attributes={TextAttributes.BOLD}>
        TASKS
      </text>
      <text fg={theme.border}>{"─".repeat(28)}</text>

      <scrollbox flexGrow={1}>
        <Show
          when={wf.plans.length > 0}
          fallback={<text fg={theme.textMuted}>No tasks planned yet</text>}
        >
          <For each={[...waves().entries()]}>
            {([waveNum, tasks]) => (
              <box flexDirection="column" marginBottom={1}>
                <text fg={theme.textMuted}>{"Wave " + waveNum}</text>
                <For each={tasks}>
                  {(task) => {
                    const activeTask = createMemo(() =>
                      wf.state?.activeTasks.find((t) => t.id === task.id),
                    )
                    const status = createMemo(() => activeTask()?.status ?? "pending")
                    const icon = createMemo(() => taskStatusIcon(status()))
                    const isSelected = createMemo(() => wf.selectedTask === task.id)
                    const statusColor = createMemo(() => {
                      switch (status()) {
                        case "completed":
                          return theme.success
                        case "in_progress":
                          return theme.warning
                        case "failed":
                          return theme.error
                        case "escalated":
                          return theme.error
                        case "blocked":
                          return theme.textMuted
                        default:
                          return theme.textMuted
                      }
                    })

                    return (
                      <box
                        flexDirection="row"
                        gap={1}
                        onMouseDown={() => wf.selectTask(task.id)}
                      >
                        <text fg={isSelected() ? theme.primary : theme.text}>
                          {isSelected() ? ">" : " "}
                        </text>
                        <text fg={statusColor()}>{icon()}</text>
                        <text
                          fg={isSelected() ? theme.primary : theme.text}
                          flexGrow={1}
                          overflow="hidden"
                        >
                          {task.id + " " + task.title}
                        </text>
                        <text fg={theme.textMuted}>{task.role}</text>
                      </box>
                    )
                  }}
                </For>
              </box>
            )}
          </For>
        </Show>
      </scrollbox>

      <text fg={theme.border}>{"─".repeat(28)}</text>
      <text fg={theme.textMuted}>
        {"Progress: " + completedCount() + "/" + wf.plans.length + " tasks"}
      </text>
    </box>
  )
}
```

- [ ] **Step 2: Verify the type checker passes**

```bash
cd packages/opencode && bunx tsgo --noEmit 2>&1
```

Expected: Zero errors.

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/task-panel.tsx
git commit -m "feat(cli): add keyboard navigation (j/k, up/down) to workflow task panel

Adds useKeyboard hook to TaskPanel that cycles through the flat list of
tasks across waves using j/k or up/down arrow keys. Follows the same
pattern used in question.tsx and other TUI components.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Tab Close Button (Gap 17)

**Files:**
- Modify: `packages/opencode/src/devilcode/workflow-tui/context.tsx`
- Modify: `packages/opencode/src/devilcode/workflow-tui/tabs/tab-bar.tsx`

- [ ] **Step 1: Add `closeTab` method to `WorkflowViewState` type and implementation**

In `packages/opencode/src/devilcode/workflow-tui/context.tsx`:

Add `closeTab` to the `WorkflowViewState` type (after the `switchTab` line):

```typescript
export type WorkflowViewState = {
  state: WorkflowState | undefined
  plans: PlanTask[]
  challenge: PlanChallenge | undefined
  review: ReviewVerdict | undefined

  selectedTask: string | undefined
  activeTab: string
  tabs: TabInfo[]

  executing: boolean
  activeSessions: Record<string, SessionInfo>
  rootSessionId: string | undefined

  // Actions
  refresh(): Promise<void>
  executeStage(stage: WorkflowStage): Promise<void>
  selectTask(taskId: string): void
  switchTab(tabId: string): void
  closeTab(tabId: string): void
  addAgentTab(info: TabInfo): void
  updateSessionOutput(sessionId: string, line: string): void
  setSessionStatus(sessionId: string, status: SessionInfo["status"]): void
  pause(): void
  setExecuting(value: boolean): void
}
```

Add the `closeTab` implementation to the `value` object (after the `switchTab` method):

```typescript
    closeTab(tabId: string) {
      const tab = store.tabs.find((t) => t.id === tabId)
      if (!tab || !tab.closeable) return
      const currentIndex = store.tabs.findIndex((t) => t.id === tabId)
      setStore("tabs", (tabs) => tabs.filter((t) => t.id !== tabId))
      if (store.activeTab === tabId) {
        const remaining = store.tabs.filter((t) => t.id !== tabId)
        const nextIndex = Math.min(currentIndex, remaining.length - 1)
        const nextTab = remaining[nextIndex] ?? remaining[0]
        if (nextTab) {
          setStore("activeTab", nextTab.id)
        }
      }
    },
```

The full modified `context.tsx` file should have these exact changes:

In the type definition, add `closeTab(tabId: string): void` after line 29 (`switchTab(tabId: string): void`).

In the `value` object, add the `closeTab` implementation after the `switchTab` method (after line 165, `},`):

```typescript
    closeTab(tabId: string) {
      const tab = store.tabs.find((t) => t.id === tabId)
      if (!tab || !tab.closeable) return
      const currentIndex = store.tabs.findIndex((t) => t.id === tabId)
      setStore("tabs", (tabs) => tabs.filter((t) => t.id !== tabId))
      if (store.activeTab === tabId) {
        const remaining = store.tabs.filter((t) => t.id !== tabId)
        const nextIndex = Math.min(currentIndex, remaining.length - 1)
        const nextTab = remaining[nextIndex] ?? remaining[0]
        if (nextTab) {
          setStore("activeTab", nextTab.id)
        }
      }
    },
```

- [ ] **Step 2: Add close button rendering to tab-bar.tsx**

Replace the entire content of `packages/opencode/src/devilcode/workflow-tui/tabs/tab-bar.tsx`:

```typescript
// packages/opencode/src/devilcode/workflow-tui/tabs/tab-bar.tsx
import { For, Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "../context"

export function TabBar() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  const agentTabs = createMemo(() => wf.tabs.filter((t) => t.kind === "agent"))
  const artifactTabs = createMemo(() => wf.tabs.filter((t) => t.kind !== "agent"))

  return (
    <box flexDirection="row" height={1} gap={1} paddingLeft={1}>
      <For each={agentTabs()}>
        {(tab) => {
          const isActive = createMemo(() => wf.activeTab === tab.id)
          return (
            <box flexDirection="row">
              <text
                fg={isActive() ? theme.primary : theme.textMuted}
                attributes={isActive() ? TextAttributes.BOLD : undefined}
                onMouseDown={() => wf.switchTab(tab.id)}
              >
                {"[" + tab.label}
              </text>
              <Show when={tab.closeable}>
                <text
                  fg={isActive() ? theme.error : theme.textMuted}
                  onMouseDown={() => wf.closeTab(tab.id)}
                >
                  {" x"}
                </text>
              </Show>
              <text
                fg={isActive() ? theme.primary : theme.textMuted}
                attributes={isActive() ? TextAttributes.BOLD : undefined}
                onMouseDown={() => wf.switchTab(tab.id)}
              >
                {"]"}
              </text>
            </box>
          )
        }}
      </For>
      <Show when={agentTabs().length > 0 && artifactTabs().length > 0}>
        <text fg={theme.border}>|</text>
      </Show>
      <For each={artifactTabs()}>
        {(tab) => {
          const isActive = createMemo(() => wf.activeTab === tab.id)
          return (
            <box flexDirection="row">
              <text
                fg={isActive() ? theme.primary : theme.textMuted}
                attributes={isActive() ? TextAttributes.BOLD : undefined}
                onMouseDown={() => wf.switchTab(tab.id)}
              >
                {"[" + tab.label}
              </text>
              <Show when={tab.closeable}>
                <text
                  fg={isActive() ? theme.error : theme.textMuted}
                  onMouseDown={() => wf.closeTab(tab.id)}
                >
                  {" x"}
                </text>
              </Show>
              <text
                fg={isActive() ? theme.primary : theme.textMuted}
                attributes={isActive() ? TextAttributes.BOLD : undefined}
                onMouseDown={() => wf.switchTab(tab.id)}
              >
                {"]"}
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}
```

- [ ] **Step 3: Verify the type checker passes**

```bash
cd packages/opencode && bunx tsgo --noEmit 2>&1
```

Expected: Zero errors.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/context.tsx packages/opencode/src/devilcode/workflow-tui/tabs/tab-bar.tsx
git commit -m "feat(cli): add close button for closeable workflow tabs

Adds closeTab() method to WorkflowViewState that removes a tab if it is
marked closeable and switches to the nearest remaining tab. Renders an
'x' close indicator after the tab label for closeable tabs, colored with
the error theme color on the active tab for visibility.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Final Verification

- [ ] **Step 1: Run the full kilocode test suite**

```bash
cd packages/opencode && bun test test/kilocode/ 2>&1
```

Expected: All tests pass.

- [ ] **Step 2: Run the type checker on the full CLI package**

```bash
cd packages/opencode && bunx tsgo --noEmit 2>&1
```

Expected: Zero errors.

- [ ] **Step 3: Verify no untracked files were left behind**

```bash
git status --short
```

Expected: Only the intentionally modified files appear. No stray debug files.
