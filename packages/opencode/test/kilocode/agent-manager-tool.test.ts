import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime, Queue } from "effect"
import { MessageID, SessionID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AgentManagerTool } from "../../src/kilocode/tool/agent-manager"
import { AgentManagerEvent, type AgentManagerStart } from "../../src/kilocode/agent-manager/event"
import { Bus } from "../../src/bus"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { Provider } from "../../src/provider/provider"

const providers = {
  test: {
    id: "test",
    name: "Test Provider",
    models: {
      "reasoning/model": {
        id: "reasoning/model",
        providerID: "test",
        name: "Reasoning Model",
        variants: { low: {}, high: {} },
      },
      // "Shared" is also offered by the kilo provider, to exercise provider resolution.
      "test/shared": { id: "test/shared", providerID: "test", name: "Shared", variants: { low: {}, high: {} } },
    },
  } as unknown as Provider.Info,
  kilo: {
    id: "kilo",
    name: "Kilo Gateway",
    models: {
      "kilo/shared": { id: "kilo/shared", providerID: "kilo", name: "Shared", variants: { low: {} } },
      "kilo/only": { id: "kilo/only", providerID: "kilo", name: "Gateway Only", variants: { low: {} } },
    },
  } as unknown as Provider.Info,
  zeta: {
    id: "zeta",
    name: "Zeta Provider",
    models: {
      "zeta/only": { id: "zeta/only", providerID: "zeta", name: "Gateway Only", variants: { low: {} } },
    },
  } as unknown as Provider.Info,
}

// Default provider is `test`, so resolution should prefer test, then kilo, then others.
function makeRuntime(defaultProviderID = "test") {
  return ManagedRuntime.make(
    Layer.mergeAll(
      Truncate.defaultLayer,
      Agent.defaultLayer,
      Bus.defaultLayer,
      CrossSpawnSpawner.defaultLayer,
      Layer.mock(Provider.Service, {
        list: () => Effect.succeed(providers),
        defaultModel: () => Effect.succeed({ providerID: defaultProviderID, modelID: "reasoning/model" }) as never,
      }),
    ),
  )
}

const runtime = makeRuntime()

async function init() {
  return runtime.runPromise(
    Effect.gen(function* () {
      const info = yield* AgentManagerTool
      return yield* Tool.init(info)
    }),
  )
}

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "call_agent_manager",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

// Run one local task and return the resolved task published on the Start event.
function publish(rt: ReturnType<typeof makeRuntime>, task: Record<string, unknown>) {
  return rt.runPromise(
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tool = yield* Tool.init(yield* AgentManagerTool)
        const bus = yield* Bus.Service
        const events = yield* Queue.unbounded<AgentManagerStart>()
        const off = yield* bus.subscribeCallback(AgentManagerEvent.Start, (item) =>
          Queue.offerUnsafe(events, item.properties),
        )
        yield* Effect.addFinalizer(() => Effect.sync(off))
        yield* tool.execute({ mode: "local", tasks: [task] }, { ...ctx, ask: () => Effect.void })
        const event = yield* Queue.take(events).pipe(Effect.timeout("2 seconds"))
        return event.tasks[0]
      }),
    ).pipe(Effect.scoped),
  )
}

describe("agent_manager tool", () => {
  test("asks for agent_manager permission", async () => {
    const tool = await init()
    const calls: unknown[] = []

    await runtime.runPromise(
      provideTmpdirInstance(() =>
        tool.execute(
          { mode: "local", tasks: [{ prompt: "Fix issue" }] },
          { ...ctx, ask: (input: unknown) => Effect.sync(() => calls.push(input)) },
        ),
      ).pipe(Effect.scoped),
    )

    expect(calls).toEqual([
      {
        permission: "agent_manager",
        patterns: ["local"],
        always: ["local"],
        metadata: { mode: "local", count: 1 },
      },
    ])
  })

  test("publishes validated model and variant selections", async () => {
    const tool = await init()

    const event = await runtime.runPromise(
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const bus = yield* Bus.Service
          const events = yield* Queue.unbounded<AgentManagerStart>()
          const off = yield* bus.subscribeCallback(AgentManagerEvent.Start, (item) =>
            Queue.offerUnsafe(events, item.properties),
          )
          yield* Effect.addFinalizer(() => Effect.sync(off))

          yield* tool.execute(
            {
              mode: "local",
              tasks: [{ prompt: "Fix issue", model: "test/reasoning/model", variant: "high" }],
            },
            { ...ctx, ask: () => Effect.void },
          )
          return yield* Queue.take(events).pipe(Effect.timeout("2 seconds"))
        }),
      ).pipe(Effect.scoped),
    )

    expect(event.tasks).toHaveLength(1)
    expect(event.tasks[0]?.prompt).toBe("Fix issue")
    expect(String(event.tasks[0]?.model?.providerID)).toBe("test")
    expect(String(event.tasks[0]?.model?.modelID)).toBe("reasoning/model")
    expect(event.tasks[0]?.variant).toBe("high")
  })

  test("resolves a model by name to the preferred (default) provider", async () => {
    const task = await publish(runtime, { prompt: "Fix", model: "Shared", variant: "low" })
    expect(String(task?.model?.providerID)).toBe("test")
    expect(String(task?.model?.modelID)).toBe("test/shared")
    expect(task?.variant).toBe("low")
  })

  test("uses the provider of a different default model when that is the user's choice", async () => {
    const rt = makeRuntime("kilo")
    const task = await publish(rt, { prompt: "Fix", model: "Shared", variant: "low" })
    expect(String(task?.model?.providerID)).toBe("kilo")
    expect(String(task?.model?.modelID)).toBe("kilo/shared")
    await rt.dispose()
  })

  test("resolves an approximate, reordered model name", async () => {
    const task = await publish(runtime, { prompt: "Fix", model: "model reasoning" })
    expect(String(task?.model?.providerID)).toBe("test")
    expect(String(task?.model?.modelID)).toBe("reasoning/model")
  })

  test("suggests close model names when a guess finds no match", async () => {
    const tool = await init()
    const result = await runtime.runPromise(
      provideTmpdirInstance(() =>
        tool.execute(
          { mode: "local", tasks: [{ prompt: "Fix", model: "reasoning supreme" }] },
          { ...ctx, ask: () => Effect.void },
        ),
      ).pipe(Effect.scoped),
    )

    expect(result.output).toContain("Closest matches:")
    expect(result.output).toContain("Reasoning Model")
    expect(result.metadata.count).toBe(0)
  })

  test("echoes how each named model resolved", async () => {
    const tool = await init()
    const result = await runtime.runPromise(
      provideTmpdirInstance(() =>
        tool.execute(
          { mode: "local", tasks: [{ prompt: "Fix", name: "Smoke", model: "Shared", variant: "high" }] },
          { ...ctx, ask: () => Effect.void },
        ),
      ).pipe(Effect.scoped),
    )

    expect(result.output).toContain("Resolved models:")
    expect(result.output).toContain("- Smoke: Shared (test) · high")
  })

  test("falls back to the kilo gateway when the preferred provider lacks the model", async () => {
    const task = await publish(runtime, { prompt: "Fix", model: "Gateway Only" })
    // Default provider `test` does not offer it; kilo is preferred over zeta.
    expect(String(task?.model?.providerID)).toBe("kilo")
  })

  test("narrows to a provider that supports the requested variant", async () => {
    const rt = makeRuntime("kilo")
    // kilo is preferred, but only `test`'s Shared has the `high` variant.
    const task = await publish(rt, { prompt: "Fix", model: "Shared", variant: "high" })
    expect(String(task?.model?.providerID)).toBe("test")
    expect(task?.variant).toBe("high")
    await rt.dispose()
  })

  test("rejects unavailable variants before requesting permission", async () => {
    const tool = await init()
    const calls: unknown[] = []

    const result = await runtime.runPromise(
      provideTmpdirInstance(() =>
        tool.execute(
          {
            mode: "local",
            tasks: [{ prompt: "Fix issue", model: "test/reasoning/model", variant: "toString" }],
          },
          { ...ctx, ask: (input: unknown) => Effect.sync(() => calls.push(input)) },
        ),
      ).pipe(Effect.scoped),
    )

    expect(calls).toEqual([])
    expect(result.output).toContain("Available variants: low, high")
    expect(result.metadata.count).toBe(0)
  })

  test("rejects inherited provider and model properties", async () => {
    const tool = await init()

    const result = await runtime.runPromise(
      provideTmpdirInstance(() =>
        tool.execute(
          { mode: "local", tasks: [{ prompt: "Fix issue", model: "__proto__/constructor" }] },
          { ...ctx, ask: () => Effect.void },
        ),
      ).pipe(Effect.scoped),
    )

    expect(result.output).toContain("model is not available: __proto__/constructor")
    expect(result.metadata.count).toBe(0)
  })

  test("requires an initial prompt for model selections", async () => {
    const tool = await init()

    await expect(
      runtime.runPromise(
        provideTmpdirInstance(() =>
          tool.execute(
            { mode: "local", tasks: [{ name: "Prepared session", model: "test/reasoning/model" }] },
            { ...ctx, ask: () => Effect.void },
          ),
        ).pipe(Effect.scoped),
      ),
    ).rejects.toThrow("A task model requires an initial prompt")
  })

  test("rejects empty tasks", async () => {
    const tool = await init()

    await expect(
      runtime.runPromise(
        provideTmpdirInstance(() =>
          tool.execute({ mode: "local", tasks: [{}] }, { ...ctx, ask: () => Effect.void }),
        ).pipe(Effect.scoped),
      ),
    ).rejects.toThrow("Each task must include prompt, name, or branchName")
  })
})
