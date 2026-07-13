// kilocode_change - new file
import { afterEach, describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config/config"
import { Identifier } from "../../src/id/id"
import { BackgroundSubagentControl } from "../../src/kilocode/background-subagent-control"
import { BackgroundTaskTool } from "../../src/kilocode/background-task-tool"
import { BackgroundTask } from "../../src/kilocode/background-task"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "../../src/tool/tool"

const agentModule = Agent as unknown as {
  get: typeof Agent.get
}

const configModule = Config as unknown as {
  get: typeof Config.get
}

const sessionModule = Session as unknown as {
  get: typeof Session.get
}

const messageModule = MessageV2 as unknown as {
  get: typeof MessageV2.get
}

const controlModule = BackgroundSubagentControl as unknown as {
  start: typeof BackgroundSubagentControl.start
  status: typeof BackgroundSubagentControl.status
  result: typeof BackgroundSubagentControl.result
  cancel: typeof BackgroundSubagentControl.cancel
}

type ToolInfo = Awaited<ReturnType<typeof BackgroundTaskTool.init>>
type ToolCtx = Tool.Context

type ConfigInfo = Awaited<ReturnType<typeof Config.get>>
type AgentInfo = Awaited<ReturnType<typeof Agent.get>>
type SessionInfo = Awaited<ReturnType<typeof Session.get>>
type ControlStartInput = Parameters<typeof BackgroundSubagentControl.start>[0]
type ControlResult = Awaited<ReturnType<typeof BackgroundSubagentControl.result>>
type ControlCancel = Awaited<ReturnType<typeof BackgroundSubagentControl.cancel>>

function sid() {
  return SessionID.make(Identifier.ascending("session"))
}

function mid() {
  return MessageID.make(Identifier.ascending("message"))
}

function cfg(input: Partial<ConfigInfo> = {}): ConfigInfo {
  return {
    mcp: {},
    experimental: {},
    ...input,
  } as unknown as ConfigInfo
}

function agent(input: Partial<AgentInfo> & { name: string; mode: "subagent" | "primary" | "all" }): AgentInfo {
  return {
    name: input.name,
    mode: input.mode,
    options: {},
    permission: input.permission ?? [],
    model: input.model,
    description: input.description,
    native: true,
  } as unknown as AgentInfo
}

function assistantMessage(input?: { modelID?: ModelID; providerID?: ProviderID; role?: string }): MessageV2.WithParts {
  return {
    info: {
      role: input?.role ?? "assistant",
      modelID: input?.modelID ?? ModelID.make("fallback-model"),
      providerID: input?.providerID ?? ProviderID.make("fallback-provider"),
      id: mid(),
    },
    parts: [],
  } as unknown as MessageV2.WithParts
}

function session(input: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: sid(),
    permission: [],
    title: "session",
    ...input,
  } as unknown as SessionInfo
}

function info(
  input: Partial<BackgroundTask.Info> & { taskID: string; status: BackgroundTask.Status },
): BackgroundTask.Info {
  return {
    taskID: input.taskID,
    parentSessionID: input.parentSessionID ?? sid(),
    childSessionID: input.childSessionID ?? sid(),
    childUserMessageID: input.childUserMessageID ?? mid(),
    generation: input.generation ?? 1,
    status: input.status,
    createdAt: input.createdAt ?? 1,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    resultMessageID: input.resultMessageID,
    error: input.error,
  }
}

function resultMessage(text: string[]): MessageV2.WithParts {
  return {
    info: { id: mid() },
    parts: text.map((item) => ({ type: "text", text: item })),
  } as unknown as MessageV2.WithParts
}

function ctx(input: Partial<ToolCtx> = {}): ToolCtx {
  return {
    sessionID: sid(),
    messageID: mid(),
    agent: "orchestrator",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    async ask() {},
    ...input,
  }
}

function createSessionGetMock(
  original: typeof Session.get,
  fn: (input: Parameters<typeof Session.get>[0]) => ReturnType<typeof Session.get>,
): typeof Session.get {
  return Object.assign((input: Parameters<typeof Session.get>[0]) => fn(input), {
    force: (input: Parameters<typeof Session.get>[0]) => fn(input),
    schema: original.schema,
  })
}

function createMessageGetMock(
  original: typeof MessageV2.get,
  fn: (input: Parameters<typeof MessageV2.get>[0]) => ReturnType<typeof MessageV2.get>,
): typeof MessageV2.get {
  return Object.assign((input: Parameters<typeof MessageV2.get>[0]) => fn(input), {
    force: (input: Parameters<typeof MessageV2.get>[0]) => fn(input),
    schema: original.schema,
  })
}

function expectNoLeak(
  result: { output: string; metadata: Record<string, unknown> },
  input?: Partial<BackgroundTask.Info>,
) {
  const text = JSON.stringify(result)
  expect(text).not.toContain("claim")
  expect(text).not.toContain("ownerToken")
  expect(text).not.toContain("childSessionID")
  expect(text).not.toContain("childUserMessageID")
  expect(text).not.toContain("resultMessageID")
  expect(text).not.toContain("parentSessionID")
  if (input?.childSessionID) expect(text).not.toContain(input.childSessionID)
  if (input?.childUserMessageID) expect(text).not.toContain(input.childUserMessageID)
  if (input?.resultMessageID) expect(text).not.toContain(input.resultMessageID)
  if (input?.parentSessionID) expect(text).not.toContain(input.parentSessionID)
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("BackgroundTaskTool", () => {
  test("uses the exact public tool id and schema for all four actions", async () => {
    const tool = await BackgroundTaskTool.init()

    expect(BackgroundTaskTool.id).toBe("background_task")
    expect(
      tool.parameters.safeParse({
        action: "start",
        description: "desc",
        prompt: "prompt",
        subagent_type: "general",
      }).success,
    ).toBe(true)
    expect(tool.parameters.safeParse({ action: "status", background_task_id: "bg_1" }).success).toBe(true)
    expect(tool.parameters.safeParse({ action: "result", background_task_id: "bg_1" }).success).toBe(true)
    expect(tool.parameters.safeParse({ action: "cancel", background_task_id: "bg_1" }).success).toBe(true)
  })

  test("public schema rejects model, provider, tools, permission, parent IDs, child IDs, claims, task_id, and command", async () => {
    const tool = await BackgroundTaskTool.init()
    const invalid = [
      {
        action: "start",
        description: "desc",
        prompt: "prompt",
        subagent_type: "general",
        model: { modelID: "x", providerID: "y" },
      },
      {
        action: "start",
        description: "desc",
        prompt: "prompt",
        subagent_type: "general",
        provider: "x",
      },
      {
        action: "start",
        description: "desc",
        prompt: "prompt",
        subagent_type: "general",
        tools: { bash: false },
      },
      {
        action: "start",
        description: "desc",
        prompt: "prompt",
        subagent_type: "general",
        permission: [],
      },
      { action: "status", background_task_id: "bg_1", parentSessionID: sid() },
      { action: "result", background_task_id: "bg_1", childSessionID: sid() },
      { action: "cancel", background_task_id: "bg_1", childUserMessageID: mid() },
      { action: "start", description: "desc", prompt: "prompt", subagent_type: "general", resultMessageID: mid() },
      { action: "start", description: "desc", prompt: "prompt", subagent_type: "general", claim: { taskID: "bg_1" } },
      { action: "start", description: "desc", prompt: "prompt", subagent_type: "general", ownerToken: "secret" },
      { action: "start", description: "desc", prompt: "prompt", subagent_type: "general", task_id: "child" },
      { action: "start", description: "desc", prompt: "prompt", subagent_type: "general", command: "x" },
    ]

    for (const item of invalid) {
      expect(tool.parameters.safeParse(item).success).toBe(false)
    }
  })

  test("start rejects unknown agents after the task permission check", async () => {
    const tool = await BackgroundTaskTool.init()
    const originalConfig = Config.get
    const originalGet = Agent.get
    let asks = 0

    configModule.get = async () => cfg()
    agentModule.get = async (name) => {
      if (name === "missing") return undefined as never
      return agent({ name, mode: "subagent" })
    }

    try {
      await expect(
        tool.execute(
          {
            action: "start",
            description: "desc",
            prompt: "prompt",
            subagent_type: "missing",
          },
          ctx({
            async ask() {
              asks++
            },
          }),
        ),
      ).rejects.toThrow("Unknown agent type: missing is not a valid agent type")
      expect(asks).toBe(1)
    } finally {
      configModule.get = originalConfig
      agentModule.get = originalGet
    }
  })

  test("start rejects primary agents", async () => {
    const tool = await BackgroundTaskTool.init()
    const originalConfig = Config.get
    const originalGet = Agent.get

    configModule.get = async () => cfg()
    agentModule.get = async (name) => {
      if (name === "build") return agent({ name, mode: "primary" })
      return agent({ name, mode: "subagent" })
    }

    try {
      await expect(
        tool.execute(
          {
            action: "start",
            description: "desc",
            prompt: "prompt",
            subagent_type: "build",
          },
          ctx(),
        ),
      ).rejects.toThrow('Agent "build" is a primary agent and cannot be used as a subagent')
    } finally {
      configModule.get = originalConfig
      agentModule.get = originalGet
    }
  })

  test("start performs the task permission check and forwards sanitized derived input to control.start exactly once", async () => {
    const tool = await BackgroundTaskTool.init()
    const originalConfig = Config.get
    const originalGet = Agent.get
    const originalSession = Session.get
    const originalMessage = MessageV2.get
    const originalStart = BackgroundSubagentControl.start
    const calls = [] as Omit<Permission.Request, "id" | "sessionID" | "tool">[]
    const parentSessionID = sid()
    const childSessionID = sid()
    const childUserMessageID = mid()
    const caller = agent({
      name: "orchestrator",
      mode: "all",
      permission: [
        { permission: "bash", pattern: "*", action: "deny" },
        { permission: "server_issue", pattern: "repo/*", action: "ask" },
      ],
    })
    const selected = agent({
      name: "alpha",
      mode: "subagent",
      permission: [],
      model: {
        modelID: ModelID.make("selected-model"),
        providerID: ProviderID.make("selected-provider"),
      },
    })
    let seen: ControlStartInput | undefined
    let count = 0

    configModule.get = async () =>
      cfg({
        mcp: {
          server: {},
        } as never,
      })
    agentModule.get = async (name) => {
      if (name === "alpha") return selected
      if (name === "orchestrator") return caller
      return undefined as never
    }
    sessionModule.get = createSessionGetMock(originalSession, async (_sessionID) =>
      session({
        id: parentSessionID,
        permission: [{ permission: "edit", pattern: "src/*", action: "deny" }],
      }),
    )
    messageModule.get = createMessageGetMock(originalMessage, async (_input) =>
      assistantMessage({
        modelID: ModelID.make("fallback-model"),
        providerID: ProviderID.make("fallback-provider"),
      }),
    )
    controlModule.start = async (input) => {
      count++
      seen = input
      return info({
        taskID: "bg_start_1",
        status: "running",
        parentSessionID: input.parentSessionID,
        childSessionID,
        childUserMessageID,
      })
    }

    try {
      const result = await tool.execute(
        {
          action: "start",
          description: "desc",
          prompt: "prompt",
          subagent_type: "alpha",
        },
        ctx({
          sessionID: parentSessionID,
          agent: "orchestrator",
          async ask(input) {
            calls.push(input)
          },
        }),
      )

      expect(calls).toEqual([
        {
          permission: "task",
          patterns: ["alpha"],
          always: ["*"],
          metadata: {
            description: "desc",
            subagent_type: "alpha",
          },
        },
      ])
      expect(count).toBe(1)
      expect(seen?.parentSessionID).toBe(parentSessionID)
      expect(seen?.title).toBe("desc (@alpha background subagent)")
      expect(seen?.prompt).toBe("prompt")
      expect(seen?.agent).toBe("alpha")
      expect(seen?.model).toEqual({
        modelID: ModelID.make("selected-model"),
        providerID: ProviderID.make("selected-provider"),
      })
      expect(seen?.tools).toEqual({
        todowrite: false,
        task: false,
        background_task: false,
      })
      expect(seen?.permission).toEqual(
        expect.arrayContaining([
          { permission: "todowrite", pattern: "*", action: "deny" },
          { permission: "task", pattern: "*", action: "deny" },
          { permission: "background_task", pattern: "*", action: "deny" },
          { permission: "edit", pattern: "src/*", action: "deny" },
          { permission: "bash", pattern: "*", action: "deny" },
          { permission: "server_issue", pattern: "repo/*", action: "ask" },
        ]),
      )
      expect(result.metadata).toEqual({
        background_task_id: "bg_start_1",
        status: "running",
      })
      expect(result.output).toBe("background_task_id: bg_start_1\nstatus: running")
      expectNoLeak(result, {
        parentSessionID,
        childSessionID,
        childUserMessageID,
      })
    } finally {
      configModule.get = originalConfig
      agentModule.get = originalGet
      sessionModule.get = originalSession
      messageModule.get = originalMessage
      controlModule.start = originalStart
    }
  })

  test("start falls back to the current assistant model and preserves todowrite when the selected agent allows it", async () => {
    const tool = await BackgroundTaskTool.init()
    const originalConfig = Config.get
    const originalGet = Agent.get
    const originalSession = Session.get
    const originalMessage = MessageV2.get
    const originalStart = BackgroundSubagentControl.start
    let seen: ControlStartInput | undefined

    configModule.get = async () => cfg()
    agentModule.get = async (name) => {
      if (name === "alpha") {
        return agent({
          name,
          mode: "subagent",
          permission: [{ permission: "todowrite", pattern: "*", action: "allow" }],
        })
      }
      return agent({ name, mode: "all", permission: [] })
    }
    sessionModule.get = createSessionGetMock(originalSession, async (_input) => session())
    messageModule.get = createMessageGetMock(originalMessage, async (_input) =>
      assistantMessage({
        modelID: ModelID.make("assistant-model"),
        providerID: ProviderID.make("assistant-provider"),
      }),
    )
    controlModule.start = async (input) => {
      seen = input
      return info({
        taskID: "bg_start_2",
        status: "running",
        parentSessionID: input.parentSessionID,
      })
    }

    try {
      await tool.execute(
        {
          action: "start",
          description: "desc",
          prompt: "prompt",
          subagent_type: "alpha",
        },
        ctx(),
      )

      expect(seen?.model).toEqual({
        modelID: ModelID.make("assistant-model"),
        providerID: ProviderID.make("assistant-provider"),
      })
      expect(seen?.tools).toEqual({
        task: false,
        background_task: false,
      })
      expect(seen?.permission).toEqual(
        expect.not.arrayContaining([{ permission: "todowrite", pattern: "*", action: "deny" }]),
      )
    } finally {
      configModule.get = originalConfig
      agentModule.get = originalGet
      sessionModule.get = originalSession
      messageModule.get = originalMessage
      controlModule.start = originalStart
    }
  })

  test("status is parent-scoped and start, status, result, and cancel outputs never expose internal fields", async () => {
    const tool = await BackgroundTaskTool.init()
    const originalStatus = BackgroundSubagentControl.status
    const originalResult = BackgroundSubagentControl.result
    const originalCancel = BackgroundSubagentControl.cancel
    const parentSessionID = sid()
    const raw = info({
      taskID: "bg_state_1",
      status: "running",
      parentSessionID,
      childSessionID: sid(),
      childUserMessageID: mid(),
      resultMessageID: mid(),
    })
    const seen = {
      status: undefined as Parameters<typeof BackgroundSubagentControl.status>[0] | undefined,
      result: undefined as Parameters<typeof BackgroundSubagentControl.result>[0] | undefined,
      cancel: undefined as Parameters<typeof BackgroundSubagentControl.cancel>[0] | undefined,
    }

    controlModule.status = (input) => {
      seen.status = input
      return raw
    }
    controlModule.result = async (input) => {
      seen.result = input
      return { info: raw, message: undefined }
    }
    controlModule.cancel = async (input) => {
      seen.cancel = input
      return { applied: true, info: raw }
    }

    try {
      const startCtx = ctx({ sessionID: parentSessionID })
      const statusResult = await tool.execute({ action: "status", background_task_id: "bg_state_1" }, startCtx)
      expect(seen.status).toEqual({ parentSessionID, taskID: "bg_state_1" })
      expect(statusResult.metadata).toEqual({
        background_task_id: "bg_state_1",
        status: "running",
      })
      expectNoLeak(statusResult, raw)

      const resultResult = await tool.execute({ action: "result", background_task_id: "bg_state_1" }, startCtx)
      expect(seen.result).toEqual({ parentSessionID, taskID: "bg_state_1" })
      expect(resultResult.metadata).toEqual({
        background_task_id: "bg_state_1",
        status: "running",
        ready: false,
      })
      expectNoLeak(resultResult, raw)

      const cancelResult = await tool.execute({ action: "cancel", background_task_id: "bg_state_1" }, startCtx)
      expect(seen.cancel).toEqual({ parentSessionID, taskID: "bg_state_1" })
      expect(cancelResult.metadata).toEqual({
        background_task_id: "bg_state_1",
        status: "running",
        applied: true,
      })
      expectNoLeak(cancelResult, raw)
    } finally {
      controlModule.status = originalStatus
      controlModule.result = originalResult
      controlModule.cancel = originalCancel
    }
  })

  test("unknown and foreign-parent handles produce identical sanitized not-found responses", async () => {
    const tool = await BackgroundTaskTool.init()
    const originalStatus = BackgroundSubagentControl.status
    const originalResult = BackgroundSubagentControl.result
    const originalCancel = BackgroundSubagentControl.cancel

    controlModule.status = () => undefined
    controlModule.result = async () => undefined
    controlModule.cancel = async () => undefined

    try {
      const one = await tool.execute({ action: "status", background_task_id: "bg_a" }, ctx())
      const two = await tool.execute({ action: "status", background_task_id: "bg_b" }, ctx())
      expect(one).toEqual(two)
      expect(one.metadata).toEqual({ status: "not_found" })

      const three = await tool.execute({ action: "result", background_task_id: "bg_a" }, ctx())
      const four = await tool.execute({ action: "result", background_task_id: "bg_b" }, ctx())
      expect(three).toEqual(four)
      expect(three.metadata).toEqual({ status: "not_found", ready: false })

      const five = await tool.execute({ action: "cancel", background_task_id: "bg_a" }, ctx())
      const six = await tool.execute({ action: "cancel", background_task_id: "bg_b" }, ctx())
      expect(five).toEqual(six)
      expect(five.metadata).toEqual({ status: "not_found", applied: false })
    } finally {
      controlModule.status = originalStatus
      controlModule.result = originalResult
      controlModule.cancel = originalCancel
    }
  })

  test("non-completed result actions never fetch a result message and expose only sanitized current status", async () => {
    const tool = await BackgroundTaskTool.init()
    const originalResult = BackgroundSubagentControl.result
    const originalMessage = MessageV2.get
    const calls = [] as string[]
    const items = [
      info({ taskID: "bg_q", status: "queued" }),
      info({ taskID: "bg_r", status: "running" }),
      info({ taskID: "bg_f", status: "failed", error: { message: "boom" } }),
      info({ taskID: "bg_c", status: "cancelled" }),
    ]

    messageModule.get = createMessageGetMock(originalMessage, async (_input) => {
      calls.push("get")
      return assistantMessage()
    })

    try {
      for (const item of items) {
        controlModule.result = async () => ({ info: item, message: undefined }) as ControlResult
        const result = await tool.execute({ action: "result", background_task_id: item.taskID }, ctx())
        expect(result.metadata).toEqual({
          background_task_id: item.taskID,
          status: item.status,
          ready: false,
          ...(item.error?.message ? { error: item.error.message } : {}),
        })
        expect(result.output).not.toContain("<background_task_result>")
        expectNoLeak(result, item)
      }
      expect(calls).toHaveLength(0)
    } finally {
      controlModule.result = originalResult
      messageModule.get = originalMessage
    }
  })

  test("completed result exposes only the final text", async () => {
    const tool = await BackgroundTaskTool.init()
    const originalResult = BackgroundSubagentControl.result
    const originalMessage = MessageV2.get
    const raw = info({
      taskID: "bg_done",
      status: "completed",
      resultMessageID: mid(),
      childSessionID: sid(),
      childUserMessageID: mid(),
      parentSessionID: sid(),
    })
    let calls = 0

    controlModule.result = async () => ({
      info: raw,
      message: resultMessage(["first text", "final text"]),
    })
    messageModule.get = createMessageGetMock(originalMessage, async (_input) => {
      calls++
      return assistantMessage()
    })

    try {
      const result = await tool.execute({ action: "result", background_task_id: "bg_done" }, ctx())
      expect(result.metadata).toEqual({
        background_task_id: "bg_done",
        status: "completed",
        ready: true,
      })
      expect(result.output).toContain("<background_task_result>")
      expect(result.output).toContain("final text")
      expect(result.output).not.toContain("first text")
      expect(calls).toBe(0)
      expectNoLeak(result, raw)
    } finally {
      controlModule.result = originalResult
      messageModule.get = originalMessage
    }
  })

  test("cancel goes through BackgroundSubagentControl.cancel and output includes applied plus sanitized status", async () => {
    const tool = await BackgroundTaskTool.init()
    const originalCancel = BackgroundSubagentControl.cancel
    const parentSessionID = sid()
    const raw = info({
      taskID: "bg_cancel_1",
      status: "cancelled",
      parentSessionID,
      childSessionID: sid(),
      childUserMessageID: mid(),
    })
    let seen: Parameters<typeof BackgroundSubagentControl.cancel>[0] | undefined

    controlModule.cancel = async (input) => {
      seen = input
      return {
        applied: true,
        info: raw,
      } satisfies NonNullable<ControlCancel>
    }

    try {
      const result = await tool.execute(
        {
          action: "cancel",
          background_task_id: "bg_cancel_1",
        },
        ctx({ sessionID: parentSessionID }),
      )

      expect(seen).toEqual({
        parentSessionID,
        taskID: "bg_cancel_1",
      })
      expect(result.metadata).toEqual({
        background_task_id: "bg_cancel_1",
        status: "cancelled",
        applied: true,
      })
      expect(result.output).toBe("background_task_id: bg_cancel_1\nstatus: cancelled\napplied: true")
      expectNoLeak(result, raw)
    } finally {
      controlModule.cancel = originalCancel
    }
  })

  test("source stays isolated and does not modify registry, agent permissions, foreground lifetimes, persistence, polling, routes, or SDK integration", async () => {
    const { readFileSync } = await import("fs")
    const content = readFileSync(new URL("../../src/kilocode/background-task-tool.ts", import.meta.url), "utf-8")

    expect(content).toContain('Tool.define("background_task"')
    expect(content).toContain("BackgroundSubagentControl.start")
    expect(content).toContain("BackgroundSubagentControl.status")
    expect(content).toContain("BackgroundSubagentControl.result")
    expect(content).toContain("BackgroundSubagentControl.cancel")
    expect(content).not.toContain("ToolRegistry")
    expect(content).not.toContain("defaultsPatch")
    expect(content).not.toContain("agents.orchestrator")
    expect(content).not.toContain("ForegroundTask")
    expect(content).not.toContain("inFlight")
    expect(content).not.toContain("ctx.abort.addEventListener")
    expect(content).not.toContain("removeEventListener")
    expect(content).not.toContain("setInterval")
    expect(content).not.toContain("setTimeout")
    expect(content).not.toContain("route")
    expect(content).not.toContain("sdk")
    expect(content).not.toContain("writeFile")
    expect(content).not.toContain("Database")
  })
})
