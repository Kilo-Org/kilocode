# Tokens Per Second Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and display token throughput metrics for Kilo CLI and VS Code conversation headers.

**Architecture:** Capture metrics at the session `finish-step` boundary, where normalized usage and server-side step duration already exist. Store metrics on `step-finish` parts, expose them through generated SDK types, and render them from the latest assistant step in CLI and VS Code UI surfaces.

**Tech Stack:** TypeScript, Bun tests, Zod schemas, Vercel AI SDK stream events, SolidJS webview UI, generated `@kilocode/sdk`.

---

## File Structure

- Modify `packages/opencode/src/session/message-v2.ts`: add optional metrics schema to `StepFinishPart`. This is shared upstream code and must use `kilocode_change` markers.
- Create `packages/opencode/src/kilocode/session/metrics.ts`: Kilo-specific helper for computed output rate and provider timing extraction.
- Create `packages/opencode/test/kilocode/session-metrics.test.ts`: unit tests for metric calculation and metadata extraction.
- Modify `packages/opencode/src/session/processor.ts`: populate step-finish metrics during `finish-step`. This is shared upstream code and must use `kilocode_change` markers.
- Modify `packages/opencode/src/cli/cmd/tui/routes/session/usage.ts`: add formatting helpers for throughput values used by TUI/sidebar display.
- Modify `packages/opencode/src/kilocode/plugins/sidebar-usage.tsx`: show latest throughput metrics in Kilo sidebar usage plugin.
- Regenerate `packages/sdk/js/src/v2/gen/*`: generated SDK types after schema changes.
- Modify `packages/kilo-vscode/webview-ui/src/types/messages/parts.ts`: add matching optional metrics type on `StepFinishPart`.
- Modify `packages/kilo-vscode/webview-ui/src/context/session-utils.ts`: add helper to choose/format display throughput from message parts.
- Modify `packages/kilo-vscode/tests/unit/session-utils.test.ts`: test UI throughput helper.
- Modify `packages/kilo-vscode/webview-ui/src/components/chat/TaskHeader.tsx`: append PP/TG values to the expanded Tokens row when metrics exist.
- Create `.changeset/<slug>.md`: patch changeset for user-facing metrics display.

## Task 1: Backend Metrics Helper

**Files:**
- Create: `packages/opencode/src/kilocode/session/metrics.ts`
- Test: `packages/opencode/test/kilocode/session-metrics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/opencode/test/kilocode/session-metrics.test.ts` with tests for generic output rate, llama.cpp-style nested timings, top-level timing fields, and invalid duration.

```ts
import { describe, expect, test } from "bun:test"
import { KiloSessionMetrics } from "../../src/kilocode/session/metrics"

describe("KiloSessionMetrics", () => {
  test("computes output tokens per second from elapsed milliseconds", () => {
    const metrics = KiloSessionMetrics.create({
      elapsed: 2_000,
      tokens: { input: 100, output: 50 },
    })

    expect(metrics).toEqual({
      duration: 2_000,
      rate: { output: 25 },
    })
  })

  test("includes reasoning tokens in computed output rate", () => {
    const metrics = KiloSessionMetrics.create({
      elapsed: 1_000,
      tokens: { input: 100, output: 50, reasoning: 10 },
    })

    expect(metrics?.rate.output).toBe(60)
  })

  test("extracts provider prompt and generation rates from llama timings", () => {
    const metrics = KiloSessionMetrics.create({
      elapsed: 3_000,
      tokens: { input: 100, output: 90 },
      metadata: {
        llama: {
          timings: {
            prompt_per_second: 412.49,
            predicted_per_second: 38.15,
          },
        },
      },
    })

    expect(metrics).toEqual({
      duration: 3_000,
      rate: { output: 30, prompt: 412.49, generation: 38.15 },
    })
  })

  test("extracts provider rates from top-level timing fields", () => {
    const metrics = KiloSessionMetrics.create({
      elapsed: 1_000,
      tokens: { input: 100, output: 10 },
      metadata: {
        prompt_per_second: 201.2,
        predicted_per_second: 44.8,
      },
    })

    expect(metrics?.rate.prompt).toBe(201.2)
    expect(metrics?.rate.generation).toBe(44.8)
  })

  test("returns undefined without positive duration or provider rates", () => {
    const metrics = KiloSessionMetrics.create({
      elapsed: 0,
      tokens: { input: 100, output: 10 },
    })

    expect(metrics).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `packages/opencode`:

```bash
bun test ./test/kilocode/session-metrics.test.ts
```

Expected: FAIL because `../../src/kilocode/session/metrics` does not exist.

- [ ] **Step 3: Implement the helper**

Create `packages/opencode/src/kilocode/session/metrics.ts`.

```ts
import { z } from "zod"
import type { MessageV2 } from "../../session/message-v2"

export namespace KiloSessionMetrics {
  const Rate = z.object({
    prompt: z.number().positive().optional(),
    generation: z.number().positive().optional(),
    output: z.number().positive().optional(),
  })

  export const Info = z.object({
    duration: z.number().positive().optional(),
    rate: Rate,
  })
  export type Info = z.infer<typeof Info>

  const value = (input: unknown): number | undefined => {
    if (typeof input !== "number") return undefined
    if (!Number.isFinite(input)) return undefined
    if (input <= 0) return undefined
    return input
  }

  const path = (input: unknown, keys: string[]): unknown => {
    if (keys.length === 0) return input
    if (!input || typeof input !== "object") return undefined
    const [head, ...tail] = keys
    return path((input as Record<string, unknown>)[head], tail)
  }

  const first = (input: unknown, paths: string[][]) => {
    return paths.map((item) => value(path(input, item))).find((item) => item !== undefined)
  }

  export function create(input: {
    elapsed: number
    tokens: MessageV2.TokenUsage
    metadata?: unknown
  }): Info | undefined {
    const seconds = input.elapsed / 1000
    const output = value(seconds > 0 ? ((input.tokens.output ?? 0) + (input.tokens.reasoning ?? 0)) / seconds : undefined)
    const prompt = first(input.metadata, [
      ["prompt_per_second"],
      ["promptPerSecond"],
      ["timings", "prompt_per_second"],
      ["timings", "promptPerSecond"],
      ["llama", "prompt_per_second"],
      ["llama", "promptPerSecond"],
      ["llama", "timings", "prompt_per_second"],
      ["llama", "timings", "promptPerSecond"],
    ])
    const generation = first(input.metadata, [
      ["predicted_per_second"],
      ["predictedPerSecond"],
      ["generation_per_second"],
      ["generationPerSecond"],
      ["timings", "predicted_per_second"],
      ["timings", "predictedPerSecond"],
      ["llama", "predicted_per_second"],
      ["llama", "predictedPerSecond"],
      ["llama", "timings", "predicted_per_second"],
      ["llama", "timings", "predictedPerSecond"],
    ])
    const rate = { prompt, generation, output }
    const parsed = Rate.safeParse(rate)
    if (!parsed.success) return undefined
    if (!parsed.data.prompt && !parsed.data.generation && !parsed.data.output) return undefined
    return { duration: value(input.elapsed), rate: parsed.data }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run from `packages/opencode`:

```bash
bun test ./test/kilocode/session-metrics.test.ts
```

Expected: PASS.

## Task 2: Persist Step Metrics

**Files:**
- Modify: `packages/opencode/src/session/message-v2.ts`
- Modify: `packages/opencode/src/session/processor.ts`
- Test: `packages/opencode/test/session/session.test.ts`

- [ ] **Step 1: Write the failing schema propagation test**

Extend the existing `step-finish token propagation via Bus event` test in `packages/opencode/test/session/session.test.ts` by adding `metrics` to `partInput` and assertions after the token assertions.

```ts
const metrics = {
  duration: 2_000,
  rate: { output: 400, prompt: 100, generation: 80 },
}

const partInput = {
  id: PartID.ascending(),
  messageID,
  sessionID: info.id,
  type: "step-finish" as const,
  reason: "stop",
  cost: 0.005,
  tokens,
  metrics,
}

expect(finish.metrics?.duration).toBe(2_000)
expect(finish.metrics?.rate.output).toBe(400)
expect(finish.metrics?.rate.prompt).toBe(100)
expect(finish.metrics?.rate.generation).toBe(80)
```

- [ ] **Step 2: Run test to verify it fails**

Run from `packages/opencode`:

```bash
bun test ./test/session/session.test.ts
```

Expected: FAIL because `StepFinishPart` schema strips or rejects `metrics`.

- [ ] **Step 3: Add metrics schema to StepFinishPart**

Modify `packages/opencode/src/session/message-v2.ts` near `StepFinishPart`.

```ts
// kilocode_change start
export const StepMetrics = z.object({
  duration: z.number().positive().optional(),
  rate: z.object({
    prompt: z.number().positive().optional(),
    generation: z.number().positive().optional(),
    output: z.number().positive().optional(),
  }),
})
export type StepMetrics = z.infer<typeof StepMetrics>
// kilocode_change end
```

Add `metrics: StepMetrics.optional()` to `StepFinishPart` inside a `kilocode_change` marker.

- [ ] **Step 4: Populate metrics in processor**

Modify `packages/opencode/src/session/processor.ts`:

- Import the helper:

```ts
// kilocode_change
import { KiloSessionMetrics } from "../kilocode/session/metrics"
```

- In the `finish-step` case after `const usage = Session.getUsage(value)` and before `Session.updatePart`, compute metrics:

```ts
// kilocode_change start
const metrics = KiloSessionMetrics.create({
  elapsed,
  tokens: usage.tokens,
  metadata: value.providerMetadata,
})
// kilocode_change end
```

- Add `metrics` to the `step-finish` part object.

- [ ] **Step 5: Run tests to verify pass**

Run from `packages/opencode`:

```bash
bun test ./test/kilocode/session-metrics.test.ts ./test/session/session.test.ts
```

Expected: PASS.

## Task 3: CLI Sidebar Formatting

**Files:**
- Modify: `packages/opencode/src/cli/cmd/tui/routes/session/usage.ts`
- Modify: `packages/opencode/src/kilocode/plugins/sidebar-usage.tsx`
- Test: `packages/opencode/test/cli/tui/usage.test.ts`

- [ ] **Step 1: Write failing formatting tests**

Add tests in `packages/opencode/test/cli/tui/usage.test.ts` for `formatRate`.

```ts
import { formatRate } from "../../../src/cli/cmd/tui/routes/session/usage"

test("formatRate rounds throughput to one decimal", () => {
  expect(formatRate(38.15)).toBe("38.2 t/s")
})

test("formatRate hides missing or invalid throughput", () => {
  expect(formatRate(undefined)).toBeUndefined()
  expect(formatRate(0)).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `packages/opencode`:

```bash
bun test ./test/cli/tui/usage.test.ts
```

Expected: FAIL because `formatRate` does not exist.

- [ ] **Step 3: Add formatter**

Modify `packages/opencode/src/cli/cmd/tui/routes/session/usage.ts`.

```ts
export function formatRate(input: number | undefined) {
  if (input === undefined) return undefined
  if (!Number.isFinite(input)) return undefined
  if (input <= 0) return undefined
  return `${input.toFixed(1)} t/s`
}
```

- [ ] **Step 4: Display rates in Kilo sidebar usage plugin**

Modify `packages/opencode/src/kilocode/plugins/sidebar-usage.tsx`:

- Import `formatRate`.
- Find the latest assistant message part with `type === "step-finish"` and `metrics`.
- Render optional lines for `PP`, `TG`, and computed `Output` rate under token usage.
- Prefer provider `generation` for `TG`; use computed `output` only when provider `generation` is absent.

- [ ] **Step 5: Run test to verify pass**

Run from `packages/opencode`:

```bash
bun test ./test/cli/tui/usage.test.ts
```

Expected: PASS.

## Task 4: SDK Regeneration

**Files:**
- Modify generated: `packages/sdk/js/src/v2/gen/*`

- [ ] **Step 1: Regenerate SDK**

Run from repo root:

```bash
./script/generate.ts
```

Expected: generated SDK types include `StepFinishPart.metrics` and `StepMetrics`-equivalent structure.

- [ ] **Step 2: Inspect generated diff**

Run:

```bash
git diff -- packages/sdk/js/src/v2/gen
```

Expected: only generated type/client/schema changes from the new `metrics` field.

## Task 5: VS Code Webview Throughput Helper

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/types/messages/parts.ts`
- Modify: `packages/kilo-vscode/webview-ui/src/context/session-utils.ts`
- Modify: `packages/kilo-vscode/tests/unit/session-utils.test.ts`

- [ ] **Step 1: Write failing helper tests**

Add imports and tests in `packages/kilo-vscode/tests/unit/session-utils.test.ts`.

```ts
import { latestRates, formatRate } from "../../webview-ui/src/context/session-utils"

it("latestRates returns provider prompt and generation rates from newest assistant step", () => {
  const msgs = [
    {
      role: "assistant",
      parts: [
        {
          id: "sf1",
          type: "step-finish" as const,
          reason: "stop",
          metrics: { duration: 2000, rate: { output: 25, prompt: 412.49, generation: 38.15 } },
        },
      ],
    },
  ]

  expect(latestRates(msgs)).toEqual({ prompt: 412.49, generation: 38.15, output: 25 })
})

it("latestRates falls back to computed output as generation", () => {
  const msgs = [
    {
      role: "assistant",
      parts: [
        {
          id: "sf1",
          type: "step-finish" as const,
          reason: "stop",
          metrics: { duration: 2000, rate: { output: 25 } },
        },
      ],
    },
  ]

  expect(latestRates(msgs)).toEqual({ generation: 25, output: 25 })
})

it("formatRate returns compact throughput text", () => {
  expect(formatRate(38.15)).toBe("38.2 t/s")
  expect(formatRate(undefined)).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `packages/kilo-vscode`:

```bash
bun run test:unit -- --grep "latestRates|formatRate"
```

Expected: FAIL because helper functions do not exist.

- [ ] **Step 3: Add webview types**

Modify `packages/kilo-vscode/webview-ui/src/types/messages/parts.ts`:

```ts
export interface StepMetrics {
  duration?: number
  rate: {
    prompt?: number
    generation?: number
    output?: number
  }
}
```

Add `metrics?: StepMetrics` to `StepFinishPart`.

- [ ] **Step 4: Add helper implementation**

Modify `packages/kilo-vscode/webview-ui/src/context/session-utils.ts`.

```ts
export function formatRate(input: number | undefined) {
  if (input === undefined) return undefined
  if (!Number.isFinite(input)) return undefined
  if (input <= 0) return undefined
  return `${input.toFixed(1)} t/s`
}

export function latestRates(msgs: Array<{ role?: string; parts?: Array<{ type?: string; metrics?: StepMetrics }> }>) {
  const msg = [...msgs].reverse().find((item) => item.role === "assistant" && item.parts?.some((part) => part.type === "step-finish" && part.metrics))
  const part = [...(msg?.parts ?? [])].reverse().find((item) => item.type === "step-finish" && item.metrics)
  if (!part?.metrics) return undefined
  const rate = part.metrics.rate
  const generation = rate.generation ?? rate.output
  if (!rate.prompt && !generation && !rate.output) return undefined
  return { prompt: rate.prompt, generation, output: rate.output }
}
```

Import `StepMetrics` from `../types/messages` or use an exported local-compatible type if the module already avoids that import.

- [ ] **Step 5: Run test to verify pass**

Run from `packages/kilo-vscode`:

```bash
bun run test:unit -- --grep "latestRates|formatRate"
```

Expected: PASS.

## Task 6: VS Code Header Display

**Files:**
- Modify: `packages/kilo-vscode/webview-ui/src/components/chat/TaskHeader.tsx`
- Modify: `packages/kilo-vscode/webview-ui/src/styles/task-header.css` if spacing needs adjustment

- [ ] **Step 1: Add rate accessor**

Modify `TaskHeader.tsx` imports:

```ts
import { latestRates, formatRate } from "../../context/session-utils"
```

Add a memo near `tokens()`:

```ts
const rates = createMemo(() => latestRates(session.messages()))
```

- [ ] **Step 2: Render compact PP/TG metrics**

In the expanded token row after cache values, render only present values:

```tsx
<Show when={formatRate(rates()?.prompt)}>
  {(value) => <span>PP {value()}</span>}
</Show>
<Show when={formatRate(rates()?.generation)}>
  {(value) => <span>TG {value()}</span>}
</Show>
```

- [ ] **Step 3: Run webview unit tests**

Run from `packages/kilo-vscode`:

```bash
bun run test:unit -- --grep "session-utils"
```

Expected: PASS.

## Task 7: Changeset and Verification

**Files:**
- Create: `.changeset/<slug>.md`

- [ ] **Step 1: Add changeset**

Create a patch changeset:

```md
---
"@kilocode/cli": patch
"kilo-code": patch
---

Show token throughput metrics for assistant responses when generation timing is available.
```

- [ ] **Step 2: Run affected backend checks**

Run from `packages/opencode`:

```bash
bun test ./test/kilocode/session-metrics.test.ts ./test/session/session.test.ts ./test/cli/tui/usage.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run affected VS Code checks**

Run from `packages/kilo-vscode`:

```bash
bun run test:unit -- --grep "session-utils"
bun run typecheck
bun run lint
```

Expected: PASS.

- [ ] **Step 4: Run annotation check**

Run from repo root:

```bash
bun run script/check-opencode-annotations.ts
```

Expected: PASS because shared `packages/opencode` changes are marked with `kilocode_change`.

## Task 8: Draft PR

**Files:**
- No additional files expected.

- [ ] **Step 1: Review final diff**

Run from repo root:

```bash
git status --short
git diff --stat
git diff --check
```

Expected: only planned files changed; `git diff --check` reports no whitespace errors.

- [ ] **Step 2: Commit changes**

Use a conventional commit:

```bash
git add packages/opencode/src/session/message-v2.ts packages/opencode/src/session/processor.ts packages/opencode/src/kilocode/session/metrics.ts packages/opencode/test/kilocode/session-metrics.test.ts packages/opencode/test/session/session.test.ts packages/opencode/src/cli/cmd/tui/routes/session/usage.ts packages/opencode/src/kilocode/plugins/sidebar-usage.tsx packages/opencode/test/cli/tui/usage.test.ts packages/sdk/js/src/v2/gen packages/kilo-vscode/webview-ui/src/types/messages/parts.ts packages/kilo-vscode/webview-ui/src/context/session-utils.ts packages/kilo-vscode/tests/unit/session-utils.test.ts packages/kilo-vscode/webview-ui/src/components/chat/TaskHeader.tsx .changeset
git commit -m "feat: show token throughput metrics"
```

- [ ] **Step 3: Push branch and create draft PR**

Run:

```bash
git push -u origin HEAD
gh pr create --draft --title "feat: show token throughput metrics" --body "$(cat <<'EOF'
## Summary
- Persist per-step token throughput metrics from assistant generation timing.
- Surface PP/TG throughput in CLI and VS Code token usage displays when available.
- Add tests for metric extraction and UI formatting.

Fixes #6579
EOF
)"
```

Expected: GitHub returns the draft PR URL.
