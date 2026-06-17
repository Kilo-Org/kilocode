import { describe, expect, test } from "bun:test"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Effect } from "effect"
import { MemoryFiles } from "@kilocode/kilo-memory/store"
import { Bus } from "../../../src/bus"
import { provideInstance, tmpdir } from "../../fixture/fixture"
import { MemoryCapture } from "../../../src/kilocode/memory/capture"
import { MemoryService } from "../../../src/kilocode/memory/service"
import { MemoryTurn } from "../../../src/kilocode/memory/turn"
import { KiloMemory, MemoryEvents, MemoryPaths } from "../../../src/kilocode/memory"
import type { MessageV2 } from "../../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../../src/session/schema"
import { ModelNotFoundError, type Provider } from "../../../src/provider/provider"
import { ModelID, ProviderID } from "../../../src/provider/schema"
import type { Session } from "../../../src/session/session"
import type { SessionSummary } from "../../../src/session/summary"

function mdl(): Provider.Model {
  return {
    id: ModelID.make("fake-memory-model"),
    providerID: ProviderID.make("test"),
    api: { id: "fake-memory-model", npm: "test-provider", url: "" },
    limit: { context: 100_000, output: 4_000 },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
  } as Provider.Model
}

function lang(outputs: string[], calls?: string[]): LanguageModelV3 {
  let idx = 0
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "fake-memory-model",
    supportedUrls: {},
    doGenerate: async (input: unknown) => {
      calls?.push(JSON.stringify(input))
      const text = outputs[idx++] ?? outputs.at(-1) ?? "{}"
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop" },
        usage: {
          inputTokens: { total: 12 },
          outputTokens: { total: 8 },
          raw: {},
        },
        warnings: [],
        providerMetadata: {},
        request: {},
        response: {},
      }
    },
  } as unknown as LanguageModelV3
}

function provider(outputs: string[], calls?: string[]): Provider.Interface {
  const model = mdl()
  const info = {
    id: model.providerID,
    name: "Test",
    source: "config",
    env: [],
    options: {},
    models: { [model.id]: model },
  } satisfies Provider.Info
  return {
    list: () => Effect.succeed({ [model.providerID]: info }),
    getProvider: () => Effect.succeed(info),
    getModel: () => Effect.succeed(model),
    getLanguage: () => Effect.succeed(lang(outputs, calls)),
    closest: () => Effect.succeed({ providerID: model.providerID, modelID: model.id }),
    getSmallModel: () => Effect.succeed(model),
    defaultModel: () => Effect.succeed({ providerID: model.providerID, modelID: model.id }),
  }
}

function small(outputs: string[], calls: string[]): Provider.Interface {
  const big = { ...mdl(), id: ModelID.make("large-memory-model") } as Provider.Model
  const tiny = { ...mdl(), id: ModelID.make("small-memory-model") } as Provider.Model
  const info = {
    id: big.providerID,
    name: "Test",
    source: "config",
    env: [],
    options: {},
    models: { [big.id]: big, [tiny.id]: tiny },
  } satisfies Provider.Info
  return {
    list: () => Effect.succeed({ [big.providerID]: info }),
    getProvider: () => Effect.succeed(info),
    getModel: () => Effect.succeed(big),
    getLanguage: (model) => {
      calls.push(model.id)
      return Effect.succeed(lang(outputs))
    },
    closest: () => Effect.succeed({ providerID: big.providerID, modelID: big.id }),
    getSmallModel: () => Effect.succeed(tiny),
    defaultModel: () => Effect.succeed({ providerID: big.providerID, modelID: big.id }),
  }
}

function selectable(outputs: string[], calls: string[]): Provider.Interface {
  const base = mdl()
  const mem = { ...base, id: ModelID.make("memory-config-model") } as Provider.Model
  const info = {
    id: base.providerID,
    name: "Test",
    source: "config",
    env: [],
    options: {},
    models: { [base.id]: base, [mem.id]: mem },
  } satisfies Provider.Info
  return {
    list: () => Effect.succeed({ [base.providerID]: info }),
    getProvider: () => Effect.succeed(info),
    getModel: (providerID, modelID) => {
      const model = info.models[modelID]
      if (model) return Effect.succeed(model)
      return Effect.fail(new ModelNotFoundError({ providerID, modelID }))
    },
    getLanguage: (model) => {
      calls.push(model.id)
      return Effect.succeed(lang(outputs))
    },
    closest: () => Effect.succeed({ providerID: base.providerID, modelID: base.id }),
    getSmallModel: () => Effect.succeed(mem),
    defaultModel: () => Effect.succeed({ providerID: base.providerID, modelID: base.id }),
  }
}

function failing(error: unknown): Provider.Interface {
  const model = mdl()
  const info = {
    id: model.providerID,
    name: "Test",
    source: "config",
    env: [],
    options: {},
    models: { [model.id]: model },
  } satisfies Provider.Info
  const language = {
    specificationVersion: "v3",
    provider: "test",
    modelId: "fake-memory-model",
    supportedUrls: {},
    doGenerate: async () => {
      throw error
    },
  } as unknown as LanguageModelV3
  return {
    list: () => Effect.succeed({ [model.providerID]: info }),
    getProvider: () => Effect.succeed(info),
    getModel: () => Effect.succeed(model),
    getLanguage: () => Effect.succeed(language),
    closest: () => Effect.succeed({ providerID: model.providerID, modelID: model.id }),
    getSmallModel: () => Effect.succeed(model),
    defaultModel: () => Effect.succeed({ providerID: model.providerID, modelID: model.id }),
  }
}

const summary = {
  summarize: () => Effect.void,
  diff: () => Effect.succeed([]),
  computeDiff: () => Effect.succeed([]),
} as SessionSummary.Interface
const layer = MemoryService.defaultLayer

function part(sessionID: SessionID, messageID: MessageID, text: string): MessageV2.TextPart {
  return {
    id: PartID.make(`prt_${messageID}_part`),
    sessionID,
    messageID,
    type: "text",
    text,
  }
}

function turns(input: { sessionID: SessionID; user: string; assistant: string; tag?: string }) {
  const model = mdl()
  const tag = input.tag ? `_${input.tag}` : ""
  const userID = MessageID.make(`msg_user${tag}`)
  const assistantID = MessageID.make(`msg_assistant${tag}`)
  return [
    {
      info: {
        id: userID,
        sessionID: input.sessionID,
        role: "user",
        time: { created: 1 },
        agent: "code",
        model: { providerID: model.providerID, modelID: model.id },
      },
      parts: [part(input.sessionID, userID, input.user)],
    },
    {
      info: {
        id: assistantID,
        sessionID: input.sessionID,
        role: "assistant",
        time: { created: 2, completed: 3 },
        parentID: userID,
        modelID: model.id,
        providerID: model.providerID,
        mode: "build",
        agent: "code",
        path: { cwd: "/repo", root: "/repo" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
      },
      parts: [part(input.sessionID, assistantID, input.assistant)],
    },
  ] as MessageV2.WithParts[]
}

function sessions(messages: MessageV2.WithParts[]): Session.Interface {
  return {
    get: () => Effect.succeed({ parentID: undefined }),
    messages: () => Effect.succeed(messages),
  } as unknown as Session.Interface
}

async function until(input: { test: () => Promise<boolean> | boolean; message: string }) {
  const stop = Date.now() + 2_500
  while (Date.now() < stop) {
    if (await input.test()) return
    await Bun.sleep(25)
  }
  throw new Error(input.message)
}

function timing(ms: number) {
  const prev = MemoryTurn.timing({ settleMs: ms })
  return () => MemoryTurn.timing(prev)
}

describe("memory capture integration", () => {
  test("turn-close auto-save off skips digest and typed model writes", async () => {
    await using tmp = await tmpdir()
    const sessionID = SessionID.make("ses_memory_auto_off")
    const ctx = { directory: tmp.path, worktree: tmp.path }
    await KiloMemory.enable({ ctx })
    await KiloMemory.configure({ ctx, settings: { autoConsolidate: false } })
    const messages = turns({
      sessionID,
      user: "remember this project command later",
      assistant: "Run package memory tests from packages/opencode.",
    })
    const calls: string[] = []

    const result = await Effect.runPromise(
      MemoryCapture.turn({
        sessionID,
        sessions: sessions(messages),
        summary,
        provider: provider([
          '{"topic":"auto off","summary":"This should not be saved."}',
          '{"operations":[{"op":"upsert_environment_fact","key":"auto_off_should_not_save","value":"This should not be saved."}],"skipped":[]}',
        ], calls),
        reason: "completed",
      }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
    )

    const root = MemoryPaths.root({ ctx })
    const shown = await KiloMemory.show({ ctx })

    expect(result).toMatchObject({ skipped: true, reason: "no_work" })
    expect(calls).toHaveLength(0)
    expect(await MemoryFiles.readSession(root, { sessionID, max: 360 })).toBeUndefined()
    expect(shown.sources.environment).not.toContain("auto_off_should_not_save")
    expect(shown.decisions).not.toContain('"kind":"digest"')
    expect(shown.decisions).toContain('"reason":"no_work"')
    expect(shown.decisions).toContain('"llm":false')
  })

  test("turn-close typed LLM saves environment memory and audit records", async () => {
    await using tmp = await tmpdir()
    const sessionID = SessionID.make("ses_memory_save")
    const ctx = { directory: tmp.path, worktree: tmp.path }
    await KiloMemory.enable({ ctx })
    await KiloMemory.configure({ ctx, settings: { autoConsolidate: true } })
    const messages = turns({
      sessionID,
      user: "what commands are needed for this repo setup?",
      assistant: "Use bun install, then bun test ./test/kilocode/memory from packages/opencode.",
    })

    const result = await Effect.runPromise(
      MemoryCapture.turn({
        sessionID,
        sessions: sessions(messages),
        summary,
        provider: provider([
          '{"topic":"repo setup","summary":"Explored repo setup commands. Next step: verify memory tests."}',
          '{"operations":[{"op":"upsert_environment_fact","section":"Commands","key":"cli_memory_tests","value":"Run bun test ./test/kilocode/memory from packages/opencode."}],"skipped":[{"reason":"transient","text":"temporary setup exploration"}]}',
        ]),
        reason: "completed",
      }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
    )

    const root = MemoryPaths.root({ ctx })
    const shown = await KiloMemory.show({ ctx })

    expect(result).toMatchObject({ skipped: false, operationCount: 1 })
    if (!("tokens" in result)) throw new Error("expected capture to save memory")
    expect(result.tokens).toBeGreaterThan(0)
    expect(shown.sources.environment).toContain("cli_memory_tests")
    expect(shown.index).toContain("type=env")
    expect(shown.decisions).toContain('"kind":"digest"')
    expect(shown.decisions).toContain('"kind":"typed"')
    expect(shown.decisions).toContain('"result":"saved"')
    expect(shown.decisions).toContain('"files":["environment.md"]')
    expect(await MemoryFiles.readSession(root, { sessionID, max: 360 })).toMatchObject({
      id: sessionID,
      topic: "repo setup",
      summary: "Explored repo setup commands. Next step: verify memory tests.",
    })
  })

  test("turn-close typed LLM does not apply remove operations", async () => {
    await using tmp = await tmpdir()
    const sessionID = SessionID.make("ses_memory_no_auto_remove")
    const ctx = { directory: tmp.path, worktree: tmp.path }
    await KiloMemory.enable({ ctx })
    await KiloMemory.remember({
      ctx,
      key: "durable_fact",
      text: "This durable fact should not be removed by auto capture.",
    })
    const messages = turns({
      sessionID,
      user: "is durable_fact still valid?",
      assistant: "The durable fact is still valid.",
    })

    const result = await Effect.runPromise(
      MemoryCapture.turn({
        sessionID,
        sessions: sessions(messages),
        summary,
        provider: provider([
          '{"topic":"durable fact","summary":"Checked that durable_fact is still valid."}',
          '{"operations":[{"op":"remove_memory","query":"durable_fact"}],"skipped":[]}',
        ]),
        reason: "completed",
      }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
    )

    const shown = await KiloMemory.show({ ctx })

    expect(result).toMatchObject({ skipped: false, operationCount: 0 })
    expect(shown.sources.project).toContain("durable_fact")
    expect(shown.index).toContain("durable_fact")
    expect(shown.decisions).not.toContain("remove_memory")
  })

  test("turn-close provenance answers do not run typed consolidation", async () => {
    await using tmp = await tmpdir()
    const sessionID = SessionID.make("ses_memory_provenance")
    const ctx = { directory: tmp.path, worktree: tmp.path }
    await KiloMemory.enable({ ctx })
    await KiloMemory.configure({ ctx, settings: { autoConsolidate: true } })
    const messages = turns({
      sessionID,
      user: "where all these came from?",
      assistant: [
        "Sources:",
        "- System/developer instructions injected into this session.",
        "- AGENTS.md.",
        "- ~/.claude/CLAUDE.md.",
        "- Saved project memory block injected at session start.",
        "- Current repo/environment metadata.",
      ].join("\n"),
    })
    const calls: string[] = []

    const result = await Effect.runPromise(
      MemoryCapture.turn({
        sessionID,
        sessions: sessions(messages),
        summary,
        provider: provider(['{"topic":"instruction provenance","summary":"Explained where session guidance came from."}'], calls),
        reason: "completed",
      }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
    )
    const shown = await KiloMemory.show({ ctx })

    expect(result).toMatchObject({ skipped: false, operationCount: 0 })
    expect(calls).toHaveLength(1)
    expect(shown.sources.project).not.toContain("System/developer")
    expect(shown.sources.project).not.toContain("CLAUDE.md")
    expect(shown.decisions).toContain('"reason":"out_of_scope"')
    expect(shown.decisions).toContain("Instruction/source provenance answers are not durable project memory.")
  })

  test("turn-close skips memory-echo turns answered from recall", async () => {
    await using tmp = await tmpdir()
    const sessionID = SessionID.make("ses_memory_echo")
    const ctx = { directory: tmp.path, worktree: tmp.path }
    await KiloMemory.enable({ ctx })
    const messages = turns({
      sessionID,
      user: "what is the kilo brand?",
      assistant: "Kilo brand colors are black and yellow.",
    })
    const last = messages.at(-1)!
    last.parts = [
      ...last.parts,
      {
        ...part(sessionID, last.info.id, ""),
        synthetic: true,
        ignored: true,
        metadata: { kiloMemory: { type: "recall", count: 1, bytes: 100, tokens: 25, files: ["project.md"] } },
      },
    ]

    const result = await Effect.runPromise(
      MemoryCapture.turn({
        sessionID,
        sessions: sessions(messages),
        summary,
        provider: provider(['{"topic":"brand","summary":"Echoed brand answer."}']),
        reason: "completed",
      }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
    )

    expect(result).toMatchObject({ skipped: true, reason: "memory_echo" })
    const root = MemoryPaths.root({ ctx })
    const item = await MemoryFiles.readSession(root, { sessionID, max: 360 })
    expect(item).toBeUndefined()
  })

  test("interval-skipped final turn is saved by the idle flush", async () => {
    const reset = timing(80)
    try {
      await using tmp = await tmpdir()
      const sessionID = SessionID.make("ses_memory_idle_flush")
      const ctx = { directory: tmp.path, worktree: tmp.path }
      await KiloMemory.enable({ ctx })
      await KiloMemory.configure({ ctx, settings: { autoConsolidate: true } })

      const first = turns({
        sessionID,
        tag: "first",
        user: "what memory behavior changed?",
        assistant: "The first pass checked memory and found nothing durable to save.",
      })
      await Effect.runPromise(
        MemoryCapture.turn({
          sessionID,
          sessions: sessions(first),
          summary,
          provider: provider([
            '{"topic":"memory followup","summary":"Checked memory capture behavior."}',
            '{"operations":[],"skipped":[]}',
          ]),
          reason: "completed",
        }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
      )

      const calls: string[] = []
      const final = turns({
        sessionID,
        tag: "final",
        user: "remember the release notes rule",
        assistant: "Release notes need a Spanish summary before reviewer handoff.",
      })
      MemoryTurn.open({ sessionID })
      await Effect.runPromise(
        MemoryTurn.close({
          sessionID,
          sessions: sessions(final),
          summary,
          provider: provider(
            [
              '{"operations":[{"op":"upsert_project_fact","key":"release_notes_spanish","value":"Release notes need a Spanish summary before reviewer handoff."}],"skipped":[]}',
            ],
            calls,
          ),
          reason: "completed",
        }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
      )

      expect(calls).toHaveLength(0)
      await until({
        message: "timed out waiting for idle memory flush",
        test: async () => {
          const shown = await KiloMemory.show({ ctx })
          return shown.sources.project.includes("release_notes_spanish")
        },
      })
      expect(calls).toHaveLength(1)
    } finally {
      reset()
    }
  })

  test("idle flush skips the model when the latest message was already consolidated", async () => {
    await using tmp = await tmpdir()
    const sessionID = SessionID.make("ses_memory_no_new_content")
    const ctx = { directory: tmp.path, worktree: tmp.path }
    await KiloMemory.enable({ ctx })
    await KiloMemory.configure({ ctx, settings: { autoConsolidate: true } })
    const messages = turns({
      sessionID,
      user: "remember the release note rule",
      assistant: "Release notes need a Spanish summary.",
    })
    await Effect.runPromise(
      MemoryCapture.turn({
        sessionID,
        sessions: sessions(messages),
        summary,
        provider: provider([
          '{"topic":"release notes","summary":"Captured the release-note summary rule."}',
          '{"operations":[],"skipped":[]}',
        ]),
        reason: "completed",
      }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
    )
    const calls: string[] = []

    const result = await Effect.runPromise(
      MemoryCapture.turn({
        sessionID,
        sessions: sessions(messages),
        summary,
        provider: provider(
          ['{"operations":[{"op":"upsert_project_fact","key":"should_not_call","value":"nope"}]}'],
          calls,
        ),
        reason: "completed",
        bypassInterval: true,
      }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
    )

    expect(result).toMatchObject({ skipped: true, reason: "no_new_content" })
    expect(calls).toHaveLength(0)
  })

  test("rapid interval-skipped turns consolidate once after activity settles", async () => {
    const reset = timing(80)
    try {
      await using tmp = await tmpdir()
      const sessionID = SessionID.make("ses_memory_rapid_idle")
      const ctx = { directory: tmp.path, worktree: tmp.path }
      await KiloMemory.enable({ ctx })
      await KiloMemory.configure({ ctx, settings: { autoConsolidate: true } })
      await Effect.runPromise(
        MemoryCapture.turn({
          sessionID,
          sessions: sessions(
            turns({
              sessionID,
              tag: "first",
              user: "what memory behavior changed first?",
              assistant: "The first consolidation armed the interval cooldown.",
            }),
          ),
          summary,
          provider: provider([
            '{"topic":"memory cadence","summary":"Initial cadence check completed."}',
            '{"operations":[],"skipped":[]}',
          ]),
          reason: "completed",
        }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
      )

      const calls: string[] = []
      const provider1 = provider(
        [
          '{"operations":[{"op":"upsert_project_fact","key":"rapid_idle_flush_one","value":"This should be canceled before it runs."}],"skipped":[]}',
        ],
        calls,
      )
      const provider2 = provider(
        [
          '{"operations":[{"op":"upsert_project_fact","key":"rapid_idle_flush_two","value":"This should also be canceled before it runs."}],"skipped":[]}',
        ],
        calls,
      )
      const provider3 = provider(
        [
          '{"operations":[{"op":"upsert_project_fact","key":"rapid_idle_flush_final","value":"Only the final rapid turn should be consolidated."}],"skipped":[]}',
        ],
        calls,
      )
      const close = async (tag: string, text: string, current: Provider.Interface) => {
        MemoryTurn.open({ sessionID })
        await Effect.runPromise(
          MemoryTurn.close({
            sessionID,
            sessions: sessions(
              turns({
                sessionID,
                tag,
                user: `remember rapid rule ${tag}`,
                assistant: text,
              }),
            ),
            summary,
            provider: current,
            reason: "completed",
          }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
        )
      }

      await close("one", "Rapid turn one should not trigger its own idle model call.", provider1)
      await Bun.sleep(25)
      await close("two", "Rapid turn two should still be inside the settle window.", provider2)
      await Bun.sleep(25)
      await close("three", "Only the final rapid turn should be saved after the user stops.", provider3)

      expect(calls).toHaveLength(0)
      await until({
        message: "timed out waiting for rapid idle memory flush",
        test: async () => {
          const shown = await KiloMemory.show({ ctx })
          return shown.sources.project.includes("rapid_idle_flush_final")
        },
      })
      const shown = await KiloMemory.show({ ctx })
      expect(calls).toHaveLength(1)
      expect(shown.sources.project).not.toContain("rapid_idle_flush_one")
      expect(shown.sources.project).not.toContain("rapid_idle_flush_two")
    } finally {
      reset()
    }
  })

  test("memory-echo turns do not schedule an idle flush model call", async () => {
    await using tmp = await tmpdir()
    const sessionID = SessionID.make("ses_memory_echo_idle")
    const ctx = { directory: tmp.path, worktree: tmp.path }
    await KiloMemory.enable({ ctx })
    await KiloMemory.configure({ ctx, settings: { autoConsolidate: true } })
    const messages = turns({
      sessionID,
      user: "what is the saved release note rule?",
      assistant: "Release notes need a Spanish summary.",
    })
    const last = messages.at(-1)!
    last.parts = [
      ...last.parts,
      {
        ...part(sessionID, last.info.id, ""),
        synthetic: true,
        ignored: true,
        metadata: { kiloMemory: { type: "recall", count: 1, bytes: 100, tokens: 25, files: ["project.md"] } },
      },
    ]
    const calls: string[] = []

    await Effect.runPromise(
      MemoryTurn.close({
        sessionID,
        sessions: sessions(messages),
        summary,
        provider: provider(
          ['{"operations":[{"op":"upsert_project_fact","key":"should_not_save","value":"nope"}]}'],
          calls,
        ),
        reason: "completed",
      }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
    )
    await Bun.sleep(900)

    expect(calls).toHaveLength(0)
  })

  test("turn-close consolidation uses the session model by default", async () => {
    await using tmp = await tmpdir()
    const sessionID = SessionID.make("ses_memory_small_model")
    const ctx = { directory: tmp.path, worktree: tmp.path }
    await KiloMemory.enable({ ctx })
    const messages = turns({
      sessionID,
      user: "what commands are needed for this repo setup?",
      assistant: "Use bun install from the repo root.",
    })
    const calls: string[] = []

    await Effect.runPromise(
      MemoryCapture.turn({
        sessionID,
        sessions: sessions(messages),
        summary,
        provider: small(['{"topic":"repo setup","summary":"Saved setup digest."}'], calls),
        reason: "completed",
      }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
    )

    expect(calls).toEqual(["large-memory-model"])
  })

  test("turn-close consolidation uses supplied memory model", async () => {
    await using tmp = await tmpdir()
    const sessionID = SessionID.make("ses_memory_config_model")
    const ctx = { directory: tmp.path, worktree: tmp.path }
    await KiloMemory.enable({ ctx })
    const messages = turns({
      sessionID,
      user: "what commands are needed for this repo setup?",
      assistant: "Use bun install from the repo root.",
    })
    const calls: string[] = []

    await Effect.runPromise(
      MemoryCapture.turn({
        sessionID,
        sessions: sessions(messages),
        summary,
        provider: selectable(['{"topic":"repo setup","summary":"Saved setup digest."}'], calls),
        reason: "completed",
        memoryModel: "test/memory-config-model",
      }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
    )

    expect(calls).toEqual(["memory-config-model"])
  })

  test("turn-close consolidation falls back when supplied memory model is unavailable", async () => {
    await using tmp = await tmpdir()
    const sessionID = SessionID.make("ses_memory_config_model_missing")
    const ctx = { directory: tmp.path, worktree: tmp.path }
    await KiloMemory.enable({ ctx })
    const messages = turns({
      sessionID,
      user: "what commands are needed for this repo setup?",
      assistant: "Use bun install from the repo root.",
    })
    const calls: string[] = []

    await Effect.runPromise(
      MemoryCapture.turn({
        sessionID,
        sessions: sessions(messages),
        summary,
        provider: selectable(['{"topic":"repo setup","summary":"Saved setup digest."}'], calls),
        reason: "completed",
        memoryModel: "test/missing-memory-model",
      }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
    )
    const shown = await KiloMemory.show({ ctx })

    expect(calls).toEqual(["fake-memory-model"])
    expect(shown.changes).toContain("memory_model_config reason=model unavailable fallback=1")
  })

  test("turn-close model rate-limit failures are audited as guard fallbacks", async () => {
    await using tmp = await tmpdir()
    const sessionID = SessionID.make("ses_memory_rate_limit")
    const ctx = { directory: tmp.path, worktree: tmp.path }
    await KiloMemory.enable({ ctx })
    await KiloMemory.configure({ ctx, settings: { autoConsolidate: true } })
    const messages = turns({
      sessionID,
      user: "what commands are needed for this repo setup?",
      assistant: "Use bun install from the repo root.",
    })
    const error = Object.assign(new Error("Rate limit exceeded"), { status: 429 })
    const errors: MemoryEvents.Status[] = []

    const result = await Effect.runPromise(
      Effect.acquireUseRelease(
        Effect.sync(() => Bus.subscribe(MemoryEvents.Error, (event) => errors.push(event.properties))),
        () =>
          MemoryCapture.turn({
            sessionID,
            sessions: sessions(messages),
            summary,
            provider: failing(error),
            reason: "completed",
          }),
        (off) => Effect.sync(off),
      ).pipe(Effect.provide(layer), provideInstance(tmp.path)),
    )
    const shown = await KiloMemory.show({ ctx })

    expect(result).toMatchObject({ skipped: false })
    expect(errors.some((event) => event.state === "error" && event.reason === "rate_limit_guard")).toBe(true)
    expect(shown.decisions).toContain('"reason":"rate_limit_guard"')
    expect(shown.decisions).toContain('"result":"fallback"')
    expect(shown.changes).toContain("digest error=rate_limit_guard")
    expect(shown.sources.environment).not.toContain("install_dependencies")
  })

  test("successful model completion clears the memory model timeout", async () => {
    await using tmp = await tmpdir()
    const sessionID = SessionID.make("ses_memory_timeout_clear")
    const ctx = { directory: tmp.path, worktree: tmp.path }
    await KiloMemory.enable({ ctx })
    await KiloMemory.configure({ ctx, settings: { autoConsolidate: true } })
    const messages = turns({
      sessionID,
      user: "what memory behavior changed?",
      assistant: "Successful memory model calls clear their timeout.",
    })
    const set = globalThis.setTimeout
    const clear = globalThis.clearTimeout
    const handles = new Set<ReturnType<typeof setTimeout>>()
    const cleared = new Set<ReturnType<typeof setTimeout>>()

    ;(globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      const handle = set(...args)
      if (args[1] === 30_000) handles.add(handle)
      return handle
    }) as typeof setTimeout
    ;(globalThis as { clearTimeout: typeof clearTimeout }).clearTimeout = ((
      handle?: Parameters<typeof clearTimeout>[0],
    ) => {
      if (handle && handles.has(handle as ReturnType<typeof setTimeout>)) {
        cleared.add(handle as ReturnType<typeof setTimeout>)
      }
      return clear(handle)
    }) as typeof clearTimeout

    try {
      await Effect.runPromise(
        MemoryCapture.turn({
          sessionID,
          sessions: sessions(messages),
          summary,
          provider: provider([
            '{"topic":"memory timeout","summary":"Verified memory timeout cleanup."}',
            '{"operations":[],"skipped":[]}',
          ]),
          reason: "completed",
        }).pipe(Effect.provide(layer), provideInstance(tmp.path)),
      )
    } finally {
      ;(globalThis as { setTimeout: typeof setTimeout }).setTimeout = set
      ;(globalThis as { clearTimeout: typeof clearTimeout }).clearTimeout = clear
    }

    expect(handles.size).toBeGreaterThan(0)
    expect([...handles].every((handle) => cleared.has(handle))).toBe(true)
  })
})
