import { expect, test } from "bun:test"
import { Permission } from "@/permission"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { execute, modes, schema, type Params } from "@/kilocode/tool/mode-switch"
import { KiloToolRegistry } from "@/kilocode/tool/registry"
import type { Agent } from "@/agent/agent"
import type * as Tool from "@/tool/tool"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Cause, Effect, Exit, Option } from "effect"
import { permissionInfo } from "@/cli/cmd/run/permission.shared"
import type { PermissionRequest } from "@kilocode/sdk/v2"
import { Provider } from "@/provider/provider"

function fakeModel(providerID: string, modelID: string, variants: Record<string, unknown> = {}): Provider.Model {
  return {
    id: ModelV2.ID.make(modelID),
    providerID: ProviderV2.ID.make(providerID),
    api: { id: providerID, npm: "@ai-sdk/openai-compatible", url: "" },
    name: modelID,
    family: undefined,
    capabilities: { input: { text: true }, output: { text: true } },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 0, input: 0, output: 0 },
    status: "alpha",
    options: {},
    headers: {},
    release_date: "1970-01-01",
    variants,
  } as Provider.Model
}

const sessionID = SessionID.make("ses_mode_switch")
const messageID = MessageID.make("msg_mode_switch")

function mode(name: string, input: Partial<Agent.Info> = {}): Agent.Info {
  return {
    name,
    mode: "primary",
    native: true,
    permission: [],
    options: {},
    ...input,
  }
}

function message(
  agent: string,
  variant?: string,
  model?: { providerID: ProviderV2.ID; modelID: ModelV2.ID },
): SessionV1.WithParts {
  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent,
      model: {
        providerID: model?.providerID ?? ProviderV2.ID.make("test"),
        modelID: model?.modelID ?? ModelV2.ID.make("test"),
        ...(variant ? { variant } : {}),
      },
    },
    parts: [
      {
        id: PartID.make("prt_mode_switch"),
        messageID,
        sessionID,
        type: "text",
        text: "Complete the task",
      },
    ],
  }
}

function fixture(input: {
  source?: string
  target?: string
  ask?: () => Effect.Effect<void>
  action?: "continue" | "stop"
  available?: Agent.Info[]
  sourceVariant?: string
  sourceModel?: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
  provider?: (
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
  ) => Effect.Effect<Provider.Model, Provider.ModelNotFoundError>
}) {
  const source = input.source ?? "code"
  const target = input.target ?? "debug"
  const updated: SessionV1.Info[] = []
  const switched: string[] = []
  const switchedModels: Array<{ providerID: ProviderV2.ID; id: ModelV2.ID; variant?: string }> = []
  const requests: Array<{ permission: string; metadata: Record<string, unknown> }> = []
  const available = input.available ?? [mode("code"), mode("debug"), mode("ask"), mode("plan")]
  const ctx = {
    sessionID,
    messageID,
    callID: "call_mode_switch",
    agent: source,
    messages: [message(source, input.sourceVariant, input.sourceModel)],
  }
  const providerGet = input.provider ?? ((pid, mid) => Effect.succeed(fakeModel(pid, mid)))
  const deps = {
    agents: {
      list: () => Effect.succeed(available),
    },
    config: {
      get: () => Effect.succeed({ mode_switch_on_reject: input.action }),
    },
    provider: {
      getModel: (pid: ProviderV2.ID, mid: ModelV2.ID) => providerGet(pid, mid),
    },
    sessions: {
      updateMessage: <T extends SessionV1.Info>(msg: T) =>
        Effect.sync(() => {
          updated.push(msg)
          return msg
        }),
    },
    ask: ((request) =>
      Effect.gen(function* () {
        requests.push({ permission: request.permission, metadata: request.metadata ?? {} })
        yield* input.ask?.() ?? Effect.void
      })) satisfies Tool.Context["ask"],
    switched: (event: { agent: string }) =>
      Effect.sync(() => {
        switched.push(event.agent)
      }),
    modelSwitched: (input: { sessionID: SessionID; model: { providerID: ProviderV2.ID; id: ModelV2.ID; variant?: string } }) =>
      Effect.sync(() => {
        switchedModels.push(input.model)
      }),
  }
  return {
    source,
    target,
    updated,
    switched,
    switchedModels,
    requests,
    run: (params: Params = { target, reason: "The task needs debugging." }) =>
      Effect.runPromise(execute(params, ctx, deps)),
    exit: (params: Params = { target, reason: "The task needs debugging." }) =>
      Effect.runPromiseExit(execute(params, ctx, deps)),
  }
}

test("automatic approval persists the destination and resumes the active user task", async () => {
  const item = fixture({})
  const result = await item.run()

  expect(result.metadata).toEqual({
    status: "switched",
    source: "code",
    target: "debug",
    reason: "The task needs debugging.",
  })
  expect(item.requests).toEqual([
    {
      permission: "mode_switch",
      metadata: { source: "code", target: "debug", reason: "The task needs debugging." },
    },
  ])
  expect(item.updated.map((msg) => (msg.role === "user" ? msg.agent : undefined))).toEqual(["debug"])
  expect(item.switched).toEqual(["debug"])
})

test("automatic approval rewrites the user message with the destination mode's model", async () => {
  const item = fixture({
    available: [
      mode("code", {
        model: { providerID: ProviderV2.ID.make("source-provider"), modelID: ModelV2.ID.make("source-model") },
      }),
      mode("debug", {
        model: { providerID: ProviderV2.ID.make("target-provider"), modelID: ModelV2.ID.make("target-model") },
        variant: "xhigh",
      }),
    ],
    provider: (pid, mid) => {
      const id = `${pid}/${mid}`
      const variants: Record<string, unknown> = id === "target-provider/target-model" ? { xhigh: {} } : {}
      return Effect.succeed(fakeModel(pid, mid, variants))
    },
  })
  await item.run()
  const updated = item.updated.find(
    (msg): msg is SessionV1.User => msg.role === "user" && msg.agent === "debug",
  )
  expect(updated?.model).toMatchObject({
    providerID: ProviderV2.ID.make("target-provider"),
    modelID: ModelV2.ID.make("target-model"),
    variant: "xhigh",
  })
  expect(item.switchedModels).toEqual([
    {
      providerID: ProviderV2.ID.make("target-provider"),
      id: ModelV2.ID.make("target-model"),
      variant: "xhigh",
    },
  ])
})

test("does not publish ModelSwitched when the destination model and variant match the source", async () => {
  const item = fixture({
    available: [
      mode("code", {
        model: { providerID: ProviderV2.ID.make("source-provider"), modelID: ModelV2.ID.make("source-model") },
      }),
      mode("debug", {
        // Destination mode configures the same provider/model AND variant as the source.
        model: { providerID: ProviderV2.ID.make("source-provider"), modelID: ModelV2.ID.make("source-model") },
        variant: "xhigh",
      }),
    ],
    sourceVariant: "xhigh",
    sourceModel: { providerID: ProviderV2.ID.make("source-provider"), modelID: ModelV2.ID.make("source-model") },
    provider: (pid, mid) => Effect.succeed(fakeModel(pid, mid, { xhigh: {} })),
  })
  await item.run()
  // The destination mode resolves to the same provider/model/variant as the source
  // user message; nothing actually changed, so ModelSwitched must not fire.
  expect(item.switchedModels).toEqual([])
})

test("drops an inherited variant when the destination model changes and that variant does not exist on it", async () => {
  const item = fixture({
    available: [
      mode("code", {
        model: { providerID: ProviderV2.ID.make("source-provider"), modelID: ModelV2.ID.make("source-model") },
      }),
      mode("debug", {
        // Destination mode configures a model but no variant. The destination model only
        // exposes "yhigh"; the source user message already carries "xhigh". The rewrite
        // must not silently apply "xhigh" to the destination model.
        model: { providerID: ProviderV2.ID.make("target-provider"), modelID: ModelV2.ID.make("target-model") },
      }),
    ],
    sourceVariant: "xhigh",
    provider: (pid, mid) =>
      Effect.succeed(
        fakeModel(pid, mid, mid === "source-model" ? { xhigh: {} } : { yhigh: {} }),
      ),
  })
  await item.run()
  const updated = item.updated.find(
    (msg): msg is SessionV1.User => msg.role === "user" && msg.agent === "debug",
  )
  // The destination mode does not specify a variant and the source variant belongs to the
  // source model only; the rewrite must drop "xhigh" instead of carrying it onto the
  // destination model.
  expect(updated?.model).toEqual({
    providerID: ProviderV2.ID.make("target-provider"),
    modelID: ModelV2.ID.make("target-model"),
  })
})

test("returns UnresolvableModelError when the destination mode's model is unknown", async () => {
  const item = fixture({
    available: [
      mode("code"),
      mode("debug", {
        model: { providerID: ProviderV2.ID.make("unknown-provider"), modelID: ModelV2.ID.make("unknown-model") },
      }),
    ],
    provider: () =>
      Effect.fail(
        new Provider.ModelNotFoundError({
          providerID: ProviderV2.ID.make("unknown-provider"),
          modelID: ModelV2.ID.make("unknown-model"),
          suggestions: [],
          modelsEmpty: false,
        }),
      ),
  })
  const exit = await item.exit()
  expect(Exit.isFailure(exit)).toBe(true)
  if (!Exit.isFailure(exit)) throw new Error("expected failure")
  const err = Cause.findErrorOption(exit.cause)
  expect(Option.isSome(err)).toBe(true)
  if (Option.isSome(err)) {
    const tag = (err.value as { _tag?: unknown })._tag
    expect(tag).toBe("ModeSwitchUnresolvableModelError")
  }
  // Persisted user message must be untouched on failure.
  expect(item.updated).toHaveLength(0)
})

test("legacy build target switches to the canonical code mode", async () => {
  const item = fixture({
    source: "plan",
    target: "build",
    available: [mode("plan"), mode("code"), mode("debug")],
  })

  const result = await item.run()

  expect(result.metadata).toMatchObject({ source: "plan", target: "code" })
  expect(item.updated.map((msg) => (msg.role === "user" ? msg.agent : undefined))).toEqual(["code"])
  expect(item.switched).toEqual(["code"])
})

test("confirmation approval follows the same switch path", async () => {
  let confirmed = false
  const item = fixture({
    ask: () =>
      Effect.sync(() => {
        confirmed = true
      }),
  })

  const result = await item.run()
  expect(confirmed).toBe(true)
  expect(result.metadata.status).toBe("switched")
  expect(item.switched).toEqual(["debug"])
})

test("denial continues in the current mode by default without a follow-up question", async () => {
  const item = fixture({
    ask: () => Effect.die(new Permission.DeniedError({ ruleset: [] })),
  })

  const result = await item.run()
  expect(result).toMatchObject({
    title: "Mode switch cancelled · Task continues in code",
    metadata: { status: "continued", source: "code", target: "debug" },
  })
  expect(item.updated).toEqual([])
  expect(item.switched).toEqual([])
})

test("configured stop returns a completed cancellation status for the processor to stop", async () => {
  const item = fixture({
    ask: () => Effect.die(new Permission.DeniedError({ ruleset: [] })),
    action: "stop",
  })

  const result = await item.run()
  expect(result).toMatchObject({
    title: "Mode switch cancelled · Task stopped",
    metadata: { status: "stopped", source: "code", target: "debug" },
  })
  expect(item.updated).toEqual([])
  expect(item.switched).toEqual([])
})

test("unavailable and custom target modes are rejected", async () => {
  const item = fixture({
    target: "custom",
    available: [
      mode("code"),
      mode("debug"),
      mode("custom", { native: false }),
      mode("hidden", { hidden: true }),
      mode("explore", { mode: "subagent" }),
    ],
  })

  const result = await item.exit()
  expect(Exit.isFailure(result)).toBe(true)
  if (Exit.isFailure(result)) {
    const err = Cause.squash(result.cause)
    expect(err).toBeInstanceOf(Error)
    if (err instanceof Error) expect(err.message).toBe('Cannot switch to mode "custom". Choose one of: debug')
  }
  expect(item.requests).toEqual([])
})

test("selecting the active mode has a dedicated error", async () => {
  const item = fixture({ target: "code" })

  const result = await item.exit()
  expect(Exit.isFailure(result)).toBe(true)
  if (Exit.isFailure(result)) {
    const err = Cause.squash(result.cause)
    expect(err).toBeInstanceOf(Error)
    if (err instanceof Error)
      expect(err.message).toBe('Mode "code" is already active. Choose a different mode: debug, ask, plan')
  }
  expect(item.requests).toEqual([])
})

test("CLI permission prompts show the source, target, and reason", () => {
  const request = {
    id: "perm_mode_switch",
    sessionID,
    permission: "mode_switch",
    patterns: ["*"],
    metadata: { source: "code", target: "debug", reason: "Investigate the failing request." },
    always: ["*"],
  } as PermissionRequest

  expect(permissionInfo(request)).toMatchObject({
    title: "Switch mode from code to debug",
    lines: ["Reason: Investigate the failing request."],
  })
})

test("all visible built-in primary modes are valid transition targets", async () => {
  const builtins = ["code", "ask", "debug", "plan", "architect", "orchestrator"].map((name) => mode(name))
  expect(
    modes([...builtins, mode("custom", { native: false }), mode("title", { hidden: true })]).map((x) => x.name),
  ).toEqual(builtins.map((item) => item.name))

  for (const source of builtins) {
    for (const target of builtins) {
      if (source.name === target.name) continue
      const item = fixture({ source: source.name, target: target.name, available: builtins })
      const result = await item.run({ target: target.name, reason: `Use ${target.name}.` })
      expect(result.metadata).toMatchObject({ status: "switched", source: source.name, target: target.name })
    }
  }
})

test("model-facing schema lists only visible built-in modes", () => {
  const builtins = [mode("code"), mode("ask"), mode("debug"), mode("plan")]
  const result = schema([
    ...builtins,
    mode("custom", { native: false }),
    mode("hidden", { hidden: true }),
    mode("explore", { mode: "subagent" }),
  ])

  expect(result.properties?.target).toMatchObject({
    type: "string",
    enum: builtins.map((item) => item.name),
  })
})

test("mode schema is resolved at request time without overriding plugin changes", async () => {
  const tool = { id: "mode_switch" } as Tool.Def
  const agents = {
    list: () => Effect.succeed([mode("code"), mode("ask"), mode("plan")]),
  }

  const generated = await Effect.runPromise(KiloToolRegistry.schema(tool, undefined, true, agents))
  expect(generated?.properties?.target).toMatchObject({ enum: ["code", "ask", "plan"] })

  const custom = { type: "object" } as const
  const preserved = await Effect.runPromise(
    KiloToolRegistry.schema(tool, custom, false, {
      list: () => Effect.die(new Error("agent list should not be called for plugin schemas")),
    }),
  )
  expect(preserved).toBe(custom)
})

test("the mode switch tool is visible only to built-in interactive modes", () => {
  const tool = { id: "mode_switch" } as Tool.Def
  expect(KiloToolRegistry.available(tool, mode("code"))).toBe(true)
  expect(KiloToolRegistry.available(tool, mode("custom", { native: false }))).toBe(false)
  expect(KiloToolRegistry.available(tool, mode("explore", { mode: "subagent" }))).toBe(false)
  expect(KiloToolRegistry.available(tool, mode("hidden", { hidden: true }))).toBe(false)
})
