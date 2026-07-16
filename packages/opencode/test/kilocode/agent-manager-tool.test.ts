import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime, Queue } from "effect"
import { MessageID, SessionID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AgentManagerTool } from "../../src/kilocode/tool/agent-manager"
import { AgentManagerEvent, type AgentManagerStart } from "../../src/kilocode/agent-manager/event"
import { AgentManager } from "../../src/kilocode/agent-manager/service"
import { Bus } from "../../src/bus"
import { Tool } from "../../src/tool/tool"
import * as ToolJsonSchema from "../../src/tool/json-schema"
import { Truncate } from "../../src/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { Provider } from "../../src/provider/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"

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
      "zeta/shared": { id: "zeta/shared", providerID: "zeta", name: "External Shared", variants: {} },
    },
  } as unknown as Provider.Info,
  alpha: {
    id: "alpha",
    name: "Alpha Provider",
    models: {
      "alpha/shared": { id: "alpha/shared", providerID: "alpha", name: "External Shared", variants: {} },
    },
  } as unknown as Provider.Info,
}

const agent: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: [],
  options: {},
}

// Default provider is `test`, so resolution should prefer test, then kilo, then others.
function makeRuntime(defaultProviderID = "test", host: Partial<AgentManager.Interface> = {}) {
  return ManagedRuntime.make(
    Layer.mergeAll(
      Truncate.defaultLayer,
      Layer.mock(Agent.Service, { get: () => Effect.succeed(agent) }),
      Bus.defaultLayer,
      CrossSpawnSpawner.defaultLayer,
      Layer.mock(AgentManager.Service, host),
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
  messages: [] as Tool.Context["messages"],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

function message(
  id: string,
  provider: string,
  model: string,
  variant?: string,
  created = 1,
): Tool.Context["messages"][number] {
  return {
    info: {
      id: MessageID.make(id),
      sessionID: ctx.sessionID,
      role: "user",
      time: { created },
      agent: "build",
      model: {
        providerID: ProviderV2.ID.make(provider),
        modelID: ModelV2.ID.make(model),
        ...(variant ? { variant } : {}),
      },
    },
    parts: [],
  }
}

// Run one local task and return the resolved task published on the Start event.
function publish(
  rt: ReturnType<typeof makeRuntime>,
  task: Record<string, unknown>,
  messages: Tool.Context["messages"] = ctx.messages,
) {
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
        yield* tool.execute({ mode: "local", tasks: [task] }, { ...ctx, messages, ask: () => Effect.void })
        const event = yield* Queue.take(events).pipe(Effect.timeout("2 seconds"))
        return event.tasks[0]
      }),
    ).pipe(Effect.scoped),
  )
}

describe("agent_manager tool", () => {
  test("uses an object-root input schema without combinators", async () => {
    const tool = await init()
    const schema = ToolJsonSchema.fromTool(tool)

    expect(schema.type).toBe("object")
    expect(schema.anyOf).toBeUndefined()
    expect(schema.oneOf).toBeUndefined()
    expect(schema.allOf).toBeUndefined()
    expect(Object.keys(schema.properties ?? {})).toEqual([
      "mode",
      "versions",
      "tasks",
      "action",
      "filter",
      "sessionID",
      "prompt",
    ])
  })

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

  test("lists the compact overview with a separate read-only permission pattern", async () => {
    const requests: unknown[] = []
    const rt = makeRuntime("test", {
      request: (input) =>
        Effect.sync(() => {
          requests.push(input)
          return {
            operation: "overview" as const,
            overview: {
              sections: [],
              ungrouped: [
                {
                  id: "wt-1",
                  name: "Fix auth",
                  branch: "fix/auth",
                  session: { id: SessionID.make("ses_target"), name: "Fix auth", activity: "idle" as const },
                },
              ],
            },
          }
        }),
    })
    const tool = await rt.runPromise(
      Effect.gen(function* () {
        return yield* Tool.init(yield* AgentManagerTool)
      }),
    )
    const permissions: unknown[] = []

    const result = await rt.runPromise(
      provideTmpdirInstance(() =>
        tool.execute(
          { action: "list" },
          { ...ctx, ask: (input: unknown) => Effect.sync(() => permissions.push(input)) },
        ),
      ).pipe(Effect.scoped),
    )

    expect(permissions).toEqual([
      {
        permission: "agent_manager",
        patterns: ["overview"],
        always: ["overview"],
        metadata: { action: "list" },
      },
    ])
    expect(requests).toEqual([{ operation: "overview", sessionID: ctx.sessionID, filter: undefined }])
    expect(JSON.parse(result.output)).toEqual({
      sections: [],
      ungrouped: [
        {
          id: "wt-1",
          name: "Fix auth",
          branch: "fix/auth",
          session: { id: "ses_target", name: "Fix auth", activity: "idle" },
        },
      ],
    })
    expect(result.metadata).toEqual(expect.objectContaining({ action: "list", count: 1 }))
    await rt.dispose()
  })

  test("prompts one existing session with a separate mutation permission pattern", async () => {
    const requests: unknown[] = []
    const rt = makeRuntime("test", {
      request: (input) =>
        Effect.sync(() => {
          requests.push(input)
          return { operation: "prompt" as const, sessionID: SessionID.make("ses_target"), delivered: true as const }
        }),
    })
    const tool = await rt.runPromise(
      Effect.gen(function* () {
        return yield* Tool.init(yield* AgentManagerTool)
      }),
    )
    const permissions: unknown[] = []
    const result = await rt.runPromise(
      provideTmpdirInstance(() =>
        tool.execute(
          { action: "prompt", sessionID: SessionID.make("ses_target"), prompt: "  Continue the fix  " },
          { ...ctx, ask: (input: unknown) => Effect.sync(() => permissions.push(input)) },
        ),
      ).pipe(Effect.scoped),
    )

    expect(permissions).toEqual([
      {
        permission: "agent_manager",
        patterns: ["prompt"],
        always: ["prompt"],
        metadata: { action: "prompt", sessionID: "ses_target" },
      },
    ])
    expect(requests).toEqual([
      {
        operation: "prompt",
        sessionID: ctx.sessionID,
        targetSessionID: "ses_target",
        prompt: "Continue the fix",
      },
    ])
    expect(result.output).toContain("accepted it asynchronously")
    expect(result.metadata).toEqual(expect.objectContaining({ action: "prompt", sessionID: "ses_target" }))
    await rt.dispose()
  })

  test("inherits the latest invoking model and variant when omitted", async () => {
    const task = await publish(runtime, { prompt: "Fix" }, [
      message("msg_current", "kilo", "kilo/shared", "low", 2),
      message("msg_old", "test", "reasoning/model", "high", 1),
    ])

    expect(String(task?.model?.providerID)).toBe("kilo")
    expect(String(task?.model?.modelID)).toBe("kilo/shared")
    expect(task?.variant).toBe("low")
  })

  test("leaves prepared sessions on normal defaults", async () => {
    const task = await publish(runtime, { name: "Prepared" }, [
      message("msg_current", "test", "reasoning/model", "high"),
    ])

    expect(task?.model).toBeUndefined()
    expect(task?.variant).toBeUndefined()
  })

  test("explicit model and variant override the invoking selection", async () => {
    const task = await publish(runtime, { prompt: "Fix", model: "test/reasoning/model", variant: "high" }, [
      message("msg_current", "kilo", "kilo/shared", "low"),
    ])

    expect(String(task?.model?.providerID)).toBe("test")
    expect(String(task?.model?.modelID)).toBe("reasoning/model")
    expect(task?.variant).toBe("high")
  })

  test("does not inherit a variant when only the model is overridden", async () => {
    const task = await publish(runtime, { prompt: "Fix", model: "Gateway Only" }, [
      message("msg_current", "test", "reasoning/model", "high"),
    ])

    expect(String(task?.model?.providerID)).toBe("kilo")
    expect(String(task?.model?.modelID)).toBe("kilo/only")
    expect(task?.variant).toBeUndefined()
  })

  test("overrides only the inherited variant when model is omitted", async () => {
    const task = await publish(runtime, { prompt: "Fix", variant: "high" }, [
      message("msg_current", "test", "reasoning/model", "low"),
    ])

    expect(String(task?.model?.providerID)).toBe("test")
    expect(String(task?.model?.modelID)).toBe("reasoning/model")
    expect(task?.variant).toBe("high")
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

  test("prefers the invoking provider for an explicit model override", async () => {
    const task = await publish(runtime, { prompt: "Fix", model: "Shared", variant: "low" }, [
      message("msg_current", "kilo", "kilo/only", "low"),
    ])
    expect(String(task?.model?.providerID)).toBe("kilo")
    expect(String(task?.model?.modelID)).toBe("kilo/shared")
  })

  test("uses a stable provider tie-breaker for explicit model overrides", async () => {
    const task = await publish(runtime, { prompt: "Fix", model: "External Shared" })
    expect(String(task?.model?.providerID)).toBe("alpha")
    expect(String(task?.model?.modelID)).toBe("alpha/shared")
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

  test("rejects unavailable variant-only overrides before requesting permission", async () => {
    const tool = await init()
    const calls: unknown[] = []

    const result = await runtime.runPromise(
      provideTmpdirInstance(() =>
        tool.execute(
          { mode: "local", tasks: [{ prompt: "Fix issue", variant: "toString" }] },
          {
            ...ctx,
            messages: [message("msg_current", "test", "reasoning/model", "low")],
            ask: (input: unknown) => Effect.sync(() => calls.push(input)),
          },
        ),
      ).pipe(Effect.scoped),
    )

    expect(calls).toEqual([])
    expect(result.output).toContain('variant "toString" is not available for Reasoning Model')
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
