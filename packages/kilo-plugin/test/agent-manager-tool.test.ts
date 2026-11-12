import { describe, expect, test } from "bun:test"
import type { AssertInput } from "@opencode/plugin/permission"
import { Agent } from "@opencode/schema/agent"
import { KiloAgentManagerRpc } from "@opencode/schema/kilocode/agent-manager"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { definition } from "@opencode/core/tool/runtime"
import { Cause, Effect, Exit, Schema } from "effect"
import { Input } from "../src/agent-manager/input"
import { TaskParams } from "../src/agent-manager/params"
import { Params } from "../src/agent-manager/params"
import type { Input as ManagerInput } from "../src/agent-manager/service"
import { makeTools, type Runtime } from "../src/agent-manager/tool"

const ctx = {
  sessionID: SessionID.make("ses_test"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_test"),
  id: Tool.CallID.make("call_agent_manager"),
  progress: () => Effect.void,
}

function model(providerID: string, id: string, name: string, variants: ReadonlyArray<string> = []) {
  const base = Model.Info.default(Provider.ID.make(providerID), Model.ID.make(id))
  return {
    ...base,
    name,
    variants: variants.map((variant) => ({ id: Model.VariantID.make(variant) })),
  }
}

const models = [
  model("test", "reasoning/model", "Reasoning Model", ["low", "high"]),
  model("test", "test/shared", "Shared", ["low", "high"]),
  model("kilo", "kilo/shared", "Shared", ["low"]),
  model("kilo", "kilo/only", "Gateway Only", ["low"]),
  model("zeta", "zeta/only", "Gateway Only", ["low"]),
  model("zeta", "zeta/shared", "External Shared"),
  model("alpha", "alpha/shared", "External Shared"),
]

function agent(name: string, mode: Agent.Info["mode"], hidden = false) {
  const base = Agent.Info.default(Agent.ID.make(name))
  return { ...base, name: Agent.Name.make(name), mode, hidden }
}

const agentsByName: Record<string, Agent.Info> = {
  build: agent("build", "primary"),
  candidate: agent("candidate", "all"),
  researcher: agent("researcher", "subagent"),
  title: agent("title", "primary", true),
}

function ref(providerID: string, id: string, variant?: string) {
  return Model.Ref.make({
    providerID: Provider.ID.make(providerID),
    id: Model.ID.make(id),
    ...(variant ? { variant: Model.VariantID.make(variant) } : {}),
  })
}

function answer(input: ManagerInput): KiloAgentManagerRpc.Result {
  if (input.operation === "overview") return { operation: "overview", overview: { sections: [], ungrouped: [] } }
  if (input.operation === "prompt") return { operation: "prompt", sessionID: input.targetSessionID, delivered: true }
  if (input.operation === "stop") return { operation: "stop", sessionID: input.targetSessionID, stopped: true }
  if (input.operation === "move")
    return { operation: "move", sessionID: input.targetSessionID, sectionID: input.sectionID, moved: true }
  return {
    operation: "answer",
    sessionID: input.targetSessionID,
    questionID: input.questionID ?? "que_1",
    resolved: true,
  }
}

type TaskInput = Schema.Schema.Type<typeof TaskParams>

function makeRuntime(
  options: {
    invoking?: Model.Ref
    agentModel?: Model.Ref
    defaultProvider?: string
    deny?: boolean
    onRequest?: (input: ManagerInput) => KiloAgentManagerRpc.Result
  } = {},
) {
  const requests: ManagerInput[] = []
  const permissions: AssertInput[] = []
  const events: KiloAgentManagerRpc.Start[] = []
  const runtime: Runtime = {
    permission: {
      assert: (input) =>
        options.deny
          ? Effect.fail(new Error("Permission denied: agent_manager"))
          : Effect.sync(() => {
              permissions.push(input)
            }),
    },
    session: { model: () => Effect.succeed(options.invoking) },
    agents: {
      list: () => Effect.succeed(Object.values(agentsByName)),
      get: (id) =>
        Effect.succeed(
          agentsByName[id] && options.agentModel && id === "build"
            ? { ...agentsByName[id], model: options.agentModel }
            : agentsByName[id],
        ),
    },
    models: {
      list: () => Effect.succeed(models),
      default: () =>
        Effect.succeed(
          options.defaultProvider
            ? models.find((item) => item.providerID === options.defaultProvider)
            : models[0],
        ),
    },
    manager: {
      request: (input) =>
        Effect.sync(() => {
          requests.push(input)
          return options.onRequest ? options.onRequest(input) : answer(input)
        }),
      list: () => Effect.succeed([]),
      reply: () => Effect.void,
      reject: () => Effect.void,
      dispose: Effect.void,
    },
    start: (event) =>
      Effect.sync(() => {
        events.push(event)
      }),
  }
  return { ...makeTools(runtime), requests, permissions, events }
}

type Validation = { value: Record<string, unknown> } | { issues: ReadonlyArray<{ message?: string }> }

interface SchemaObject {
  type?: string
  anyOf?: ReadonlyArray<SchemaObject>
  oneOf?: unknown
  allOf?: unknown
  description?: string
  enum?: ReadonlyArray<unknown>
  properties?: Record<string, SchemaObject>
  required?: ReadonlyArray<string>
  minItems?: number
  maxItems?: number
}

async function validate(input: unknown): Promise<Validation> {
  return (await Input["~standard"].validate(input)) as Validation
}

function decode(input: unknown) {
  return Schema.decodeUnknownSync(Params)(input) as Record<string, unknown>
}

function publish(subject: ReturnType<typeof makeRuntime>, task: TaskInput) {
  return Effect.runPromise(subject.agentManager.execute({ mode: "local", tasks: [task] }, ctx))
}

describe("agent_manager tool", () => {
  test("tells models to start sessions only on explicit user intent", () => {
    const subject = makeRuntime()
    expect(subject.agentManager.description).toContain("Start sessions only when the user explicitly asks")
    expect(subject.agentManager.description).toContain("Never start them on your own")
  })

  test("advertises one flat object schema with every field nullable", () => {
    const subject = makeRuntime()
    const schema = definition(subject.agentManager).inputSchema as SchemaObject

    expect(schema.type).toBe("object")
    expect(schema.anyOf).toBeUndefined()
    expect(schema.oneOf).toBeUndefined()
    expect(schema.allOf).toBeUndefined()
    const action = schema.properties?.action
    expect(action?.anyOf?.[0]).toEqual(
      expect.objectContaining({ enum: ["list", "prompt", "stop", "move", "answer"] }),
    )
    expect(action?.description).toContain("Use list first")
    expect(action?.description).toContain("Never edit")
    expect(schema.properties?.sessionID).toEqual(
      expect.objectContaining({ description: expect.stringContaining("IDs start with ses_") }),
    )
    expect(schema.properties?.sectionID).toEqual(
      expect.objectContaining({
        anyOf: expect.arrayContaining([expect.objectContaining({ type: "string" }), { type: "null" }]),
      }),
    )
    expect(Object.keys(schema.properties ?? {})).toEqual([
      "mode",
      "versions",
      "tasks",
      "worktreeID",
      "action",
      "filter",
      "sessionID",
      "prompt",
      "replyTo",
      "sectionID",
      "questionID",
      "answers",
    ])
    expect(schema.required).toEqual(Object.keys(schema.properties ?? {}))

    for (const key of Object.keys(schema.properties ?? {})) {
      const branches = schema.properties?.[key]?.anyOf
      expect(branches?.some((branch) => branch.type === "null")).toBe(true)
    }
    expect(schema.properties?.tasks?.anyOf).toHaveLength(2)
    expect(schema.properties?.tasks?.anyOf?.[0]).toEqual(
      expect.objectContaining({ type: "array", minItems: 1, maxItems: 20 }),
    )
  })

  test("routes null-filled requests to the selected operation", async () => {
    const task = { prompt: "balabala...", name: "a new name", branchName: "a-new-branch", model: "", variant: "" }
    const start = {
      mode: "worktree",
      versions: false,
      tasks: [task],
      worktreeID: null,
      action: null,
      filter: null,
      sessionID: null,
      prompt: null,
    }
    const started = decode(start)
    expect("action" in started).toBe(false)
    expect(started.mode).toBe("worktree")
    expect(started.tasks).toHaveLength(1)
    expect("action" in decode({ ...start, sessionID: "", prompt: "" })).toBe(false)

    const blanks = { mode: null, versions: null, tasks: null, worktreeID: null, filter: null }
    expect(decode({ ...blanks, action: "list", sessionID: null, prompt: null })).toEqual({ action: "list", filter: null })
    expect(decode({ ...blanks, action: "stop", sessionID: "ses_target", prompt: null })).toEqual({
      action: "stop",
      sessionID: "ses_target",
    })
    expect(
      decode({ ...blanks, action: "move", sessionID: "ses_target", sectionID: null, prompt: null }),
    ).toEqual({ action: "move", sessionID: "ses_target", sectionID: null })
    expect(
      decode({ ...blanks, action: "prompt", sessionID: "ses_target", prompt: "done", replyTo: "amr_request" }),
    ).toEqual({ action: "prompt", sessionID: "ses_target", prompt: "done", replyTo: "amr_request" })
    expect(decode({ ...blanks, action: "answer", sessionID: "ses_target", answers: [["Yes"]] })).toEqual({
      action: "answer",
      sessionID: "ses_target",
      answers: [["Yes"]],
    })
    expect(
      decode({ ...blanks, action: "answer", sessionID: "ses_target", questionID: "que_1", answers: [["Yes"], []] }),
    ).toEqual({
      action: "answer",
      sessionID: "ses_target",
      questionID: "que_1",
      answers: [["Yes"], []],
    })
  })

  test("decodes JSON-encoded tasks", async () => {
    const tasks = [{ prompt: 'Check "quoted" text\nC:\\repo', name: "Encoded" }]
    const result = await validate({ mode: "local", tasks: JSON.stringify(tasks), action: null })
    expect("value" in result && result.value).toEqual({ mode: "local", tasks })
  })

  test("rejects invalid JSON-encoded tasks before permission or event publication", async () => {
    for (const tasks of ["[", "null", "{}", '"[]"', "[]", "[null]", "[{}]", JSON.stringify([{ prompt: 42 }])]) {
      const result = await validate({ mode: "local", tasks })
      expect("issues" in result).toBe(true)
      if ("issues" in result) expect(result.issues?.length).toBeGreaterThan(0)
    }
  })

  test("validates worktree targeting before permission", async () => {
    for (const input of [
      { worktreeID: "" },
      { worktreeID: "  " },
      { worktreeID: "wt-target", mode: "worktree" },
      { worktreeID: "wt-target", versions: true },
      { worktreeID: "wt-target", tasks: [{ prompt: "Fix", branchName: "" }] },
    ]) {
      const result = await validate({ mode: "local", tasks: [{ prompt: "Fix" }], ...input })
      expect("issues" in result).toBe(true)
    }
    const subject = makeRuntime()
    await Effect.runPromise(
      subject.agentManager.execute({ mode: "local", worktreeID: "wt-target", tasks: [{ name: "Prepared" }] }, ctx),
    )
    expect(subject.events[0]?.worktreeID).toBe("wt-target")
    expect(subject.permissions.at(-1)).toMatchObject({
      metadata: { mode: "local", count: 1, worktreeID: "wt-target" },
    })
  })

  test("accepts a base branch only for new worktree tasks", async () => {
    const task = { name: "Base", baseBranch: "main" }
    expect("value" in (await validate({ mode: "worktree", tasks: [task] }))).toBe(true)
    expect("issues" in (await validate({ mode: "worktree", tasks: [{ name: "Base", baseBranch: 42 }] }))).toBe(true)

    const local = await validate({ mode: "local", tasks: [task] })
    if (!("issues" in local)) throw new Error("expected a validation failure")
    expect(local.issues?.[0]?.message).toContain("baseBranch requires mode worktree")
    for (const baseBranch of [null, "", "  "])
      expect("value" in (await validate({ mode: "local", tasks: [{ name: "Base", baseBranch }] }))).toBe(true)

    for (const tasks of [[task], JSON.stringify([task])]) {
      const targeted = await validate({ mode: "local", worktreeID: "wt-target", tasks })
      if (!("issues" in targeted)) throw new Error("expected a validation failure")
      expect(targeted.issues?.[0]?.message).toContain("worktreeID cannot be combined with baseBranch")
    }
  })

  test("publishes a trimmed base branch for worktree tasks", async () => {
    const subject = makeRuntime()
    await Effect.runPromise(
      subject.agentManager.execute(
        { mode: "worktree", tasks: [{ name: "Release", baseBranch: " release/1.0 " }, { name: "Default" }] },
        ctx,
      ),
    )
    expect(subject.events[0]?.tasks).toEqual([{ name: "Release", baseBranch: "release/1.0" }, { name: "Default" }])
  })

  test("documents the base branch and its constraints", () => {
    const subject = makeRuntime()
    expect(subject.agentManager.description).toContain("set `baseBranch` to the existing branch")
    expect(subject.agentManager.description).toContain("cannot be combined with `worktreeID` or with local mode")
    expect(subject.agentManager.description).not.toContain("only the base branch always uses the normal default")
  })

  test("explains how to recover from a worktreeID in worktree mode", async () => {
    const result = await validate({ mode: "worktree", worktreeID: "null", tasks: [{ name: "test" }] })
    if (!("issues" in result)) throw new Error("expected a validation failure")
    expect(result.issues?.[0]?.message).toContain('worktreeID "null" requires mode local')
    expect(result.issues?.[0]?.message).toContain("omit worktreeID or send JSON null")
  })

  test("keeps session ID validation local", async () => {
    expect("value" in (await validate({ action: "stop", sessionID: "ses_target" }))).toBe(true)
    expect("issues" in (await validate({ action: "stop", sessionID: "invalid" }))).toBe(true)
  })

  test("validates provider selectors at the task level", async () => {
    expect("value" in (await validate({ mode: "local", tasks: [{ prompt: "Fix", model: "Shared", provider: "kilo" }] }))).toBe(
      true,
    )
    expect("issues" in (await validate({ mode: "local", tasks: [{ prompt: "Fix", provider: "kilo" }] }))).toBe(true)
    expect("issues" in (await validate({ mode: "local", tasks: [{ prompt: "Fix", model: "Shared", provider: 42 }] }))).toBe(
      true,
    )
  })

  test("rejects an answer without answers or with an empty label array", async () => {
    expect("issues" in (await validate({ action: "answer", sessionID: "ses_target" }))).toBe(true)
    expect("issues" in (await validate({ action: "answer", sessionID: "ses_target", answers: [[""]] }))).toBe(true)
    expect("issues" in (await validate({ action: "answer", sessionID: "ses_target", answers: [] }))).toBe(true)
  })

  test("asks for agent_manager permission on start", async () => {
    const subject = makeRuntime()
    await publish(subject, { prompt: "Fix issue" })

    expect(subject.permissions).toEqual([
      {
        sessionID: ctx.sessionID,
        agent: ctx.agent,
        action: "agent_manager",
        resources: ["local"],
        save: ["local"],
        metadata: { mode: "local", count: 1 },
      },
    ])
  })

  test("lists the compact overview with a read-only permission pattern", async () => {
    const subject = makeRuntime({
      onRequest: () => ({
        operation: "overview",
        overview: {
          sections: [],
          ungrouped: [
            {
              id: "wt-1",
              name: "Fix auth",
              branch: "fix/auth",
              session: { id: SessionID.make("ses_target"), name: "Fix auth", activity: "idle" },
            },
          ],
        },
      }),
    })
    const result = await Effect.runPromise(subject.agentManager.execute({ action: "list" }, ctx))

    expect(subject.permissions).toEqual([
      {
        sessionID: ctx.sessionID,
        agent: ctx.agent,
        action: "agent_manager",
        resources: ["overview"],
        save: ["overview"],
        metadata: { action: "list" },
      },
    ])
    expect(JSON.parse(result.output!)).toEqual({
      instructions:
        "This overview is the source of truth. Use sections[].id as sectionID and sessions[].id/session.id as sessionID for action=move. Do not edit .kilo2/agent-manager.json.",
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
  })

  test.each([
    { name: "single-line", prompt: "Continue the fix" },
    { name: "multiline", prompt: 'Review <script>alert("test")</script>.\n\n  Keep `code` and **markup** literal.' },
    { name: "long", prompt: "Review the next file.\n".repeat(500) + "Report the final result." },
  ])("previews the full $name prompt before sending it to one session", async (item) => {
    const subject = makeRuntime()
    const result = await Effect.runPromise(
      subject.agentManager.execute(
        { action: "prompt", sessionID: SessionID.make("ses_target"), prompt: `  ${item.prompt}\n ` },
        ctx,
      ),
    )

    expect(subject.permissions).toEqual([
      {
        sessionID: ctx.sessionID,
        agent: ctx.agent,
        action: "agent_manager",
        resources: ["prompt"],
        save: ["prompt"],
        metadata: {
          action: "prompt",
          sessionID: "ses_target",
          description: `Send a prompt to Agent Manager session ses_target:\n\n${item.prompt}`,
        },
      },
    ])
    expect(subject.requests).toEqual([
      {
        operation: "prompt",
        sessionID: ctx.sessionID,
        sourceSessionID: ctx.sessionID,
        targetSessionID: SessionID.make("ses_target"),
        prompt: item.prompt,
      },
    ])
    expect(result.output).toContain("queued behind active work")
    expect(result.output).toContain("does not wait for completion")
  })

  test("forwards a peer reply reference", async () => {
    const subject = makeRuntime()
    const result = await Effect.runPromise(
      subject.agentManager.execute(
        {
          action: "prompt",
          sessionID: SessionID.make("ses_caller"),
          prompt: "The change is complete.",
          replyTo: "amr_request",
        },
        ctx,
      ),
    )

    expect(subject.permissions[0]).toMatchObject({
      metadata: { action: "prompt", sessionID: "ses_caller", replyTo: "amr_request" },
    })
    expect(subject.requests[0]).toMatchObject({ replyTo: "amr_request" })
    expect(result.output).toContain("does not wait for completion")
  })

  test("stops, moves, and answers with their mutation patterns", async () => {
    const subject = makeRuntime()
    await Effect.runPromise(subject.agentManager.execute({ action: "stop", sessionID: SessionID.make("ses_target") }, ctx))
    await Effect.runPromise(
      subject.agentManager.execute(
        { action: "move", sessionID: SessionID.make("ses_target"), sectionID: "sec_review" },
        ctx,
      ),
    )
    await Effect.runPromise(
      subject.agentManager.execute(
        { action: "answer", sessionID: SessionID.make("ses_target"), answers: [["Yes"], ["detail"]] },
        ctx,
      ),
    )

    expect(subject.permissions.map((item) => item.resources[0])).toEqual(["stop", "move", "answer"])
    expect(subject.requests.map((item) => item.operation)).toEqual(["stop", "move", "answer"])
  })

  test("inherits the invoking model and variant when omitted", async () => {
    const subject = makeRuntime({ invoking: ref("kilo", "kilo/shared", "low") })
    const result = await publish(subject, { prompt: "Fix" })
    const event = subject.events[0]!

    expect(event.tasks[0]?.model).toEqual({ providerID: "kilo", modelID: "kilo/shared" })
    expect(event.tasks[0]?.variant).toBe("low")
    expect(result.output).toContain("request_id:")
  })

  test("falls back to the invoking agent model when the session has none", async () => {
    const subject = makeRuntime({ agentModel: ref("kilo", "kilo/shared", "low") })
    await publish(subject, { prompt: "Fix" })
    expect(subject.events[0]?.tasks[0]?.model).toEqual({ providerID: "kilo", modelID: "kilo/shared" })
    expect(subject.events[0]?.tasks[0]?.variant).toBe("low")
  })

  test("leaves prepared sessions on normal defaults", async () => {
    const subject = makeRuntime({ invoking: ref("test", "reasoning/model", "high") })
    await publish(subject, { name: "Prepared" })
    expect(subject.events[0]?.tasks[0]?.model).toBeUndefined()
    expect(subject.events[0]?.tasks[0]?.variant).toBeUndefined()
  })

  test("explicit model and variant override the invoking selection", async () => {
    const subject = makeRuntime({ invoking: ref("kilo", "kilo/shared", "low") })
    await publish(subject, { prompt: "Fix", model: "test/reasoning/model", variant: "high" })
    expect(subject.events[0]?.tasks[0]?.model).toEqual({ providerID: "test", modelID: "reasoning/model" })
    expect(subject.events[0]?.tasks[0]?.variant).toBe("high")
  })

  test("does not inherit a variant when only the model is overridden", async () => {
    const subject = makeRuntime({ invoking: ref("test", "reasoning/model", "high") })
    await publish(subject, { prompt: "Fix", model: "Gateway Only" })
    expect(subject.events[0]?.tasks[0]?.model).toEqual({ providerID: "kilo", modelID: "kilo/only" })
    expect(subject.events[0]?.tasks[0]?.variant).toBeUndefined()
  })

  test("inherits the invoking variant when the override resolves to the invoking model", async () => {
    const subject = makeRuntime({ invoking: ref("kilo", "kilo/shared", "low") })
    await publish(subject, { prompt: "Fix", model: "Shared" })
    expect(subject.events[0]?.tasks[0]?.model).toEqual({ providerID: "kilo", modelID: "kilo/shared" })
    expect(subject.events[0]?.tasks[0]?.variant).toBe("low")
  })

  test("resolves a model by name to the preferred provider", async () => {
    const subject = makeRuntime()
    await publish(subject, { prompt: "Fix", model: "Shared", variant: "low" })
    expect(subject.events[0]?.tasks[0]?.model).toEqual({ providerID: "test", modelID: "test/shared" })
  })

  test("uses an explicitly selected provider for a shared model name", async () => {
    const subject = makeRuntime()
    await publish(subject, { prompt: "Fix", model: " Shared ", provider: " kilo " })
    expect(subject.events[0]?.tasks[0]?.model).toEqual({ providerID: "kilo", modelID: "kilo/shared" })
  })

  test("reports a model unavailable from an explicit provider before permission", async () => {
    const subject = makeRuntime()
    const result = await publish(subject, { prompt: "Fix", model: "Reasoning Model", provider: "kilo" })
    expect(subject.permissions).toEqual([])
    expect(result.output).toContain('model is not available from provider "kilo": Reasoning Model')
    expect(result.metadata).toMatchObject({ count: 0 })
  })

  test("rejects unavailable variants before requesting permission", async () => {
    const subject = makeRuntime()
    const result = await publish(subject, {
      prompt: "Fix issue",
      model: "test/reasoning/model",
      variant: "toString",
    })
    expect(subject.permissions).toEqual([])
    expect(result.output).toContain("Available variants: low, high")
  })

  test("prefers the default provider when no model is invoking one", async () => {
    const subject = makeRuntime({ defaultProvider: "kilo" })
    await publish(subject, { prompt: "Fix", model: "Shared" })
    expect(subject.events[0]?.tasks[0]?.model).toEqual({ providerID: "kilo", modelID: "kilo/shared" })
  })

  test("overrides only the variant on the invoking model", async () => {
    const subject = makeRuntime({ invoking: ref("test", "reasoning/model", "low") })
    await publish(subject, { prompt: "Fix", variant: "high" })
    expect(subject.events[0]?.tasks[0]?.model).toEqual({ providerID: "test", modelID: "reasoning/model" })
    expect(subject.events[0]?.tasks[0]?.variant).toBe("high")
  })

  test("rejects an empty section ID", async () => {
    expect("issues" in (await validate({ action: "move", sessionID: "ses_target", sectionID: "" }))).toBe(true)
    expect("value" in (await validate({ action: "move", sessionID: "ses_target", sectionID: null }))).toBe(true)
  })

  test("validates the named agent and advertises the selectable set", async () => {
    const subject = makeRuntime()
    const missing = await publish(subject, { prompt: "Fix", agent: "does-not-exist" })
    const subagent = await publish(subject, { prompt: "Fix", agent: "researcher" })
    const hidden = await publish(subject, { prompt: "Fix", agent: "title" })

    expect(missing.output).toContain('Agent "does-not-exist" not found.')
    expect(missing.output).toContain("Available agents: build, candidate")
    expect(subagent.output).toContain('Agent "researcher" is a subagent')
    expect(hidden.output).toContain('Agent "title" is an internal agent')
    expect(subject.permissions).toEqual([])
    expect(subject.events).toEqual([])
  })

  test("publishes a trimmed valid agent without requiring a prompt", async () => {
    const subject = makeRuntime()
    await publish(subject, { name: "Prepared", agent: "  candidate  " })
    expect(subject.events[0]?.tasks[0]?.agent).toBe("candidate")
  })

  test("does not publish any session when one task's agent is invalid", async () => {
    const subject = makeRuntime()
    await Effect.runPromise(
      subject.agentManager.execute(
        {
          mode: "local",
          tasks: [
            { prompt: "Fix one", agent: "candidate" },
            { prompt: "Fix two", agent: "researcher" },
          ],
        },
        ctx,
      ),
    )
    expect(subject.events).toEqual([])
  })

  test("echoes how each named model resolved", async () => {
    const subject = makeRuntime()
    const result = await publish(subject, { prompt: "Fix", name: "Smoke", model: "Shared", variant: "high" })
    expect(result.output).toContain("Resolved models:")
    expect(result.output).toContain("- Smoke: Shared (test) · high")
  })

  test("rejects inherited provider and model properties", async () => {
    const subject = makeRuntime()
    const result = await publish(subject, { prompt: "Fix issue", model: "__proto__/constructor" })
    expect(result.output).toContain("model is not available: __proto__/constructor")
    expect(result.metadata).toMatchObject({ count: 0 })
  })

  test("rejects empty tasks and model selections without a prompt", async () => {
    const empty = await validate({ mode: "local", tasks: [{}] })
    expect("issues" in empty && empty.issues?.[0]?.message).toContain("Each task must include prompt, name, or branchName")

    const withoutPrompt = await validate({
      mode: "local",
      tasks: [{ name: "Prepared session", model: "test/reasoning/model" }],
    })
    expect("issues" in withoutPrompt && withoutPrompt.issues?.[0]?.message).toContain(
      "A task model requires an initial prompt",
    )
  })

  test("a rejected permission stops the call", async () => {
    const subject = makeRuntime({ deny: true })
    const exit = await Effect.runPromiseExit(
      subject.agentManager.execute({ mode: "local", tasks: [{ prompt: "Fix" }] }, ctx),
    )
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(Tool.Error)
    expect(subject.events).toEqual([])
  })
})
