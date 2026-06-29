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
}) {
  return Effect.runPromise(
    MemoryCapture.turn({
      root: input.root,
      sessionID: "ses_effect",
      session: input.session,
      model: input.model,
      memoryModel: input.memoryModel,
      reason: "completed",
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
})
