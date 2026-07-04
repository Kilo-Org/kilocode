import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { digestPrompt, typedPrompt } from "../src/capture/capture"
import { MemoryCapture } from "../src/effect/capture"
import { KiloMemory } from "../src/effect/index"
import type { MemoryPorts } from "../src/effect/ports"
import { MemoryService } from "../src/effect/service"
import { MemoryTimers } from "../src/effect/timers"
import { MemoryFiles } from "../src/storage/store"

async function tmp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-memory-effect-"))
  return {
    root: path.join(dir, "memory"),
    async done() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

const USAGE = { inputTokens: { total: 12 }, outputTokens: { total: 8 } }

function view(over: Partial<MemoryPorts.TurnView> = {}): MemoryPorts.TurnView {
  return {
    user: "what commands are needed for this repo setup?",
    assistant: "Use bun install, then bun test ./test from packages/opencode.",
    recent: "User: setup?\n\nAssistant: bun install then bun test.",
    lastAssistantID: "msg_assistant",
    sessionModel: { providerID: "test", modelID: "fake-memory-model" },
    recalledMemory: false,
    diffs: [],
    ...over,
  }
}

/** Session port that always surfaces the given turn (or none). */
function session(turn: MemoryPorts.TurnView | undefined): MemoryPorts.SessionPort {
  return {
    readTurn: () => Effect.succeed(turn),
    get: () => Effect.succeed({ parentID: undefined }),
  }
}

/** Model port that answers digest/typed calls from canned JSON, keyed by system prompt so it is
 * order-independent (digest and typed run concurrently). */
function model(input: { digest: string; typed: string; fallback?: string; onRun?: () => void }): MemoryPorts.ModelPort {
  return {
    resolve: () => Effect.succeed({ handle: {}, ...(input.fallback ? { fallback: { reason: input.fallback } } : {}) }),
    run: async ({ system }) => {
      input.onRun?.()
      const text = system === digestPrompt ? input.digest : system === typedPrompt ? input.typed : "{}"
      return { text, usage: USAGE }
    },
  }
}

function run(input: {
  root: string
  session: MemoryPorts.SessionPort
  model: MemoryPorts.ModelPort
  memoryModel?: string
  reason?: "completed" | "interrupted" | "error"
}) {
  return Effect.runPromise(
    MemoryCapture.turn({
      root: input.root,
      sessionID: "ses_effect",
      session: input.session,
      model: input.model,
      memoryModel: input.memoryModel,
      reason: input.reason ?? "completed",
    }).pipe(Effect.provideService(MemoryService.Service, MemoryService.make())),
  )
}

describe("MemoryCapture (fake ports)", () => {
  test("turn-close typed LLM saves environment memory and audit records", async () => {
    const t = await tmp()
    try {
      await KiloMemory.enable({ root: t.root })
      await KiloMemory.configure({ root: t.root, settings: { autoConsolidate: true } })

      const result = await run({
        root: t.root,
        session: session(view()),
        model: model({
          digest: '{"topic":"repo setup","summary":"Explored repo setup commands. Next step: verify memory tests."}',
          typed:
            '{"operations":[{"op":"upsert_environment_fact","section":"Commands","key":"cli_memory_tests","value":"Run bun test ./test from packages/opencode."}],"skipped":[]}',
        }),
      })

      expect(result).toMatchObject({ skipped: false, operationCount: 1 })
      if (!("tokens" in result)) throw new Error("expected capture to save memory")
      expect(result.tokens).toBeGreaterThan(0)

      const shown = await KiloMemory.show({ root: t.root })
      expect(shown.sources.environment).toContain("cli_memory_tests")
      expect(shown.decisions).toContain('"kind":"digest"')
      expect(shown.decisions).toContain('"kind":"typed"')
      expect(shown.decisions).toContain('"result":"saved"')
    } finally {
      await t.done()
    }
  })

  test("turn-close skips a secret-like op and applies the rest of the batch", async () => {
    const t = await tmp()
    try {
      await KiloMemory.enable({ root: t.root })
      await KiloMemory.configure({ root: t.root, settings: { autoConsolidate: true } })

      const result = await run({
        root: t.root,
        session: session(view()),
        model: model({
          digest: '{"topic":"repo","summary":"Explored repo setup. Next: verify."}',
          typed:
            '{"operations":[' +
            '{"op":"upsert_environment_fact","section":"Commands","key":"deploy","value":"Use TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890"},' +
            '{"op":"upsert_environment_fact","section":"Commands","key":"cli_tests","value":"Run bun test ./test."}' +
            '],"skipped":[]}',
        }),
      })

      expect(result).toMatchObject({ skipped: false, operationCount: 1 })
      const shown = await KiloMemory.show({ root: t.root })
      expect(shown.sources.environment).toContain("cli_tests")
      expect(shown.sources.environment).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234567890")
      expect(shown.decisions).toContain('"reason":"secret"')
      // The audit record itself must not carry the raw secret (decisions are exposed via /memory/show).
      expect(shown.decisions).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234567890")
    } finally {
      await t.done()
    }
  })

  test("turn-close surfaces content-gate rejections in the audit with redacted text", async () => {
    const t = await tmp()
    try {
      await KiloMemory.enable({ root: t.root })
      await KiloMemory.configure({ root: t.root, settings: { autoConsolidate: true } })

      const result = await run({
        root: t.root,
        session: session(view()),
        model: model({
          digest: '{"topic":"repo","summary":"Explored repo setup. Next: verify."}',
          typed:
            '{"operations":[' +
            '{"op":"upsert_project_fact","key":"gate_check","value":"The password=hunter2 flow was investigated."},' +
            '{"op":"upsert_environment_fact","section":"Commands","key":"cli_tests","value":"Run bun test ./test."}' +
            '],"skipped":[]}',
        }),
      })

      expect(result).toMatchObject({ skipped: false, operationCount: 1 })
      const shown = await KiloMemory.show({ root: t.root })
      expect(shown.sources.project).not.toContain("gate_check")
      // The apply-time content gate is visible in the audit, and its recorded text is redacted.
      expect(shown.decisions).toContain('"reason":"self_referential"')
      expect(shown.decisions).toContain("[redacted]")
      expect(shown.decisions).not.toContain("password=hunter2")
    } finally {
      await t.done()
    }
  })

  test("turn-close supersedes an existing fact via an exact-key upsert", async () => {
    const t = await tmp()
    try {
      await KiloMemory.enable({ root: t.root })
      await KiloMemory.configure({ root: t.root, settings: { autoConsolidate: true } })
      await KiloMemory.apply({
        root: t.root,
        ops: [{ action: "add", file: "project.md", section: "Facts", key: "deploy_target", text: "Deploy to staging." }],
      })

      const result = await run({
        root: t.root,
        session: session(view()),
        model: model({
          digest: '{"topic":"repo","summary":"Explored repo setup. Next: verify."}',
          typed:
            '{"operations":[{"op":"upsert_project_fact","key":"deploy_target","value":"Deploy to production now."}],"skipped":[]}',
        }),
      })

      expect(result).toMatchObject({ skipped: false, operationCount: 1 })
      const shown = await KiloMemory.show({ root: t.root })
      expect(shown.sources.project).toContain("Deploy to production now.")
      expect(shown.sources.project).not.toContain("Deploy to staging.")
    } finally {
      await t.done()
    }
  })

  test("turn-close defers auto-removes — hard removes stay explicit-only", async () => {
    const t = await tmp()
    try {
      await KiloMemory.enable({ root: t.root })
      await KiloMemory.configure({ root: t.root, settings: { autoConsolidate: true } })
      await KiloMemory.apply({
        root: t.root,
        ops: [
          { action: "add", file: "project.md", section: "Facts", key: "wrong_fact", text: "The old API base is v1." },
          { action: "add", file: "project.md", section: "Facts", key: "keep_fact", text: "Keep this durable fact." },
        ],
      })

      // Model emits an exact-key remove and a fuzzy remove. V0 keeps hard removes explicit-only, so
      // auto-capture applies neither — a model spuriously removing a still-valid fact cannot delete it.
      const result = await run({
        root: t.root,
        session: session(view()),
        model: model({
          digest: '{"topic":"repo","summary":"Explored repo setup. Next: verify."}',
          typed:
            '{"operations":[{"op":"remove_memory","query":"wrong_fact"},{"op":"remove_memory","query":"some paraphrase that matches nothing"}],"skipped":[]}',
        }),
      })

      expect(result).toMatchObject({ operationCount: 0 })
      const shown = await KiloMemory.show({ root: t.root })
      expect(shown.sources.project).toContain("wrong_fact")
      expect(shown.sources.project).toContain("keep_fact")
    } finally {
      await t.done()
    }
  })

  test("recall echo still runs typed capture for a short lookup", async () => {
    const t = await tmp()
    try {
      await KiloMemory.enable({ root: t.root })
      await KiloMemory.configure({ root: t.root, settings: { autoConsolidate: true } })

      let runs = 0
      const result = await run({
        root: t.root,
        session: session(
          view({
            user: "What is the repo test rule?",
            assistant: "Use package-level tests.",
            recalledMemory: true,
            diffs: [],
          }),
        ),
        model: model({
          digest: '{"topic":"x","summary":"should not be digested under echo"}',
          typed:
            '{"operations":[{"op":"upsert_environment_fact","section":"Commands","key":"package_tests","value":"Run package-level tests."}],"skipped":[]}',
          onRun: () => runs++,
        }),
      })

      expect(result).toMatchObject({ skipped: false, operationCount: 1 })
      expect(runs).toBe(1) // typed ran; digest did not
      const shown = await KiloMemory.show({ root: t.root })
      expect(shown.sources.environment).toContain("package_tests")
    } finally {
      await t.done()
    }
  })

  test("interrupted close records a non-LLM fallback digest tagged with the reason", async () => {
    const t = await tmp()
    try {
      await KiloMemory.enable({ root: t.root })
      await KiloMemory.configure({ root: t.root, settings: { autoConsolidate: true } })

      let runs = 0
      const result = await run({
        root: t.root,
        reason: "interrupted",
        session: session(view()),
        model: model({ digest: "{}", typed: "{}", onRun: () => runs++ }),
      })

      expect(result).toMatchObject({ skipped: true })
      expect(runs).toBe(0) // zero model cost
      const shown = await KiloMemory.show({ root: t.root })
      expect(shown.decisions).toContain("session digest fallback on interrupted")
      expect(shown.decisions).toContain('"fallback":true')
    } finally {
      await t.done()
    }
  })

  test("auto-consolidate off skips digest and typed model writes", async () => {
    const t = await tmp()
    try {
      await KiloMemory.enable({ root: t.root })
      await KiloMemory.configure({ root: t.root, settings: { autoConsolidate: false } })

      let runs = 0
      const result = await run({
        root: t.root,
        session: session(view()),
        model: model({
          digest: '{"topic":"x","summary":"should not be saved"}',
          typed: '{"operations":[{"op":"upsert_environment_fact","key":"nope","value":"x"}],"skipped":[]}',
          onRun: () => runs++,
        }),
      })

      expect(result).toMatchObject({ skipped: true })
      expect(runs).toBe(0)
      const shown = await KiloMemory.show({ root: t.root })
      expect(shown.sources.environment).not.toContain("nope")
    } finally {
      await t.done()
    }
  })

  test("records audit when configured memory model is unavailable", async () => {
    const t = await tmp()
    try {
      await KiloMemory.enable({ root: t.root })
      await KiloMemory.configure({ root: t.root, settings: { autoConsolidate: true } })

      await run({
        root: t.root,
        session: session(view()),
        memoryModel: "test/missing-memory-model",
        model: model({
          digest: '{"topic":"repo","summary":"Explored repo setup. Next: verify."}',
          typed: '{"operations":[],"skipped":[]}',
          fallback: "model unavailable",
        }),
      })

      const shown = await KiloMemory.show({ root: t.root })
      expect(shown.changes).toContain("memory_model_config reason=model unavailable fallback=1")
    } finally {
      await t.done()
    }
  })

  test("no turn to capture is skipped", async () => {
    const t = await tmp()
    try {
      await KiloMemory.enable({ root: t.root })
      const result = await run({
        root: t.root,
        session: session(undefined),
        model: model({ digest: "{}", typed: "{}" }),
      })
      expect(result).toMatchObject({ skipped: true, reason: "no_turn" })
    } finally {
      await t.done()
    }
  })

  test("typed evidence leads with dedup context so tail truncation keeps it", async () => {
    const t = await tmp()
    try {
      await KiloMemory.enable({ root: t.root })
      await KiloMemory.configure({ root: t.root, settings: { autoConsolidate: true } })
      await KiloMemory.apply({
        root: t.root,
        ops: [{ action: "add", file: "project.md", section: "Facts", key: "deploy_target", text: "Deploy to staging." }],
      })

      // P1.7: existing_memory / recent_memory_digests must precede latest_assistant so cap() sheds the
      // transcript bulk first and the model keeps the context that prevents re-saving duplicates.
      let typedSeen = ""
      const recording: MemoryPorts.ModelPort = {
        resolve: () => Effect.succeed({ handle: {} }),
        run: async ({ system, prompt }) => {
          if (system === typedPrompt) typedSeen = prompt
          return {
            text:
              system === digestPrompt
                ? '{"topic":"repo","summary":"Explored repo setup. Next: verify."}'
                : '{"operations":[],"skipped":[]}',
            usage: USAGE,
          }
        },
      }
      await run({ root: t.root, session: session(view()), model: recording })

      const existing = typedSeen.indexOf("## existing_memory")
      const assistant = typedSeen.indexOf("## latest_assistant")
      expect(existing).toBeGreaterThanOrEqual(0)
      expect(assistant).toBeGreaterThanOrEqual(0)
      expect(existing).toBeLessThan(assistant)
      expect(typedSeen).toContain("deploy_target")
    } finally {
      await t.done()
    }
  })

  test("provenance suppressor is skipped when the turn actually edits AGENTS.md", async () => {
    const t = await tmp()
    try {
      await KiloMemory.enable({ root: t.root })
      await KiloMemory.configure({ root: t.root, settings: { autoConsolidate: true } })

      // Assistant text names AGENTS.md 4+ times (would trip the provenance suppressor), but the diff
      // shows AGENTS.md was actually edited — real work on the file, so typed capture must still run.
      const assistant = [
        "Updated AGENTS.md to document the test rule.",
        "AGENTS.md now says to run package tests.",
        "The AGENTS.md change lives in the root AGENTS.md file.",
      ].join(" ")
      const result = await run({
        root: t.root,
        session: session(
          view({ assistant, diffs: [{ file: "AGENTS.md", status: "modified", additions: 6, deletions: 1 }] }),
        ),
        model: model({
          digest: '{"topic":"docs","summary":"Edited AGENTS.md. Next: verify."}',
          typed:
            '{"operations":[{"op":"upsert_project_fact","key":"agents_rule","value":"Root AGENTS.md documents running package tests."}],"skipped":[]}',
        }),
      })

      expect(result).toMatchObject({ skipped: false, operationCount: 1 })
      const shown = await KiloMemory.show({ root: t.root })
      expect(shown.sources.project).toContain("agents_rule")
    } finally {
      await t.done()
    }
  })
})

describe("MemoryService digest-only commit", () => {
  test("a digest-only commit leaves the typed-interval clock untouched", async () => {
    const t = await tmp()
    try {
      await KiloMemory.enable({ root: t.root })
      const svc = MemoryService.make()
      const commit = (over: Partial<Parameters<typeof svc.commit>[0]>) =>
        Effect.runPromise(
          svc.commit({
            root: t.root,
            now: 9000,
            messageID: "m",
            tokens: 0,
            count: 0,
            digest: true,
            typed: false,
            skipped: [],
            ...over,
          }),
        )

      // P1.8: digest-only commit must not advance lastTypedConsolidationAt (shared across sessions).
      await commit({})
      const afterDigest = await MemoryFiles.readState(t.root)
      expect(afterDigest.stats.lastTypedConsolidationAt).toBeNull()

      // A typed attempt does advance it.
      await commit({ typed: true })
      const afterTyped = await MemoryFiles.readState(t.root)
      expect(afterTyped.stats.lastTypedConsolidationAt).toBe(9000)
    } finally {
      await t.done()
    }
  })
})

describe("MemoryService recordRecall", () => {
  test("records the last active recall (session, count, time) into stats", async () => {
    const t = await tmp()
    try {
      await KiloMemory.enable({ root: t.root })
      const svc = MemoryService.make()
      await Effect.runPromise(svc.recordRecall({ root: t.root, sessionID: "ses_recall", now: 4242, count: 3 }))
      const state = await MemoryFiles.readState(t.root)
      expect(state.stats.lastRecallAt).toBe(4242)
      expect(state.stats.lastRecallCount).toBe(3)
      expect(state.stats.lastRecallSessionID).toBe("ses_recall")
    } finally {
      await t.done()
    }
  })
})

describe("MemoryService turn-lock ref-counting", () => {
  test("keeps one semaphore per session until the last holder drops", () => {
    const svc = MemoryService.make()
    const a = svc.turnLock("ses_lock")
    const b = svc.turnLock("ses_lock")
    expect(b).toBe(a) // a queued close() shares the same semaphore as the holder it waits on
    svc.dropLock("ses_lock") // first holder settles; second is still queued/holding
    const c = svc.turnLock("ses_lock")
    expect(c).toBe(a) // a later close() must not get a fresh semaphore while a holder remains
    svc.dropLock("ses_lock")
    svc.dropLock("ses_lock") // last holder leaves → entry dropped
    const fresh = svc.turnLock("ses_lock")
    expect(fresh).not.toBe(a) // only now does a new turn get a new semaphore
    svc.dropLock("ses_lock")
  })
})

describe("MemoryTimers signal ref-counting", () => {
  test("shares one controller per root and drops it once the last capture releases", () => {
    const root = "/kilo-memory/ref-count-root"
    const first = MemoryTimers.signal(root)
    const second = MemoryTimers.signal(root)
    expect(second).toBe(first) // concurrent captures share the controller
    MemoryTimers.release(root)
    expect(MemoryTimers.signal(root)).toBe(first) // still alive while one capture remains
    MemoryTimers.release(root)
    MemoryTimers.release(root) // last in-flight capture settles → controller dropped
    const fresh = MemoryTimers.signal(root)
    expect(fresh).not.toBe(first) // next capture gets a new controller, proving cleanup
    MemoryTimers.release(root)
  })
})
