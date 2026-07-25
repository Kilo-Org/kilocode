import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Agent } from "@/agent/agent"
import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import { KiloToolRegistry } from "@/kilocode/tool/registry"
import { NotifyUserTool } from "@/kilocode/tool/notify-user"
import { MessageID, SessionID } from "@/session/schema"
import * as Truncate from "@/tool/truncate"
import type { Tool } from "@/tool/tool"

const agentInfo = {
  name: "code",
  mode: "primary",
  options: {},
  permission: {},
} as Agent.Info

const agents = Agent.Service.of({
  get: () => Effect.succeed(agentInfo),
  list: () => Effect.succeed([agentInfo]),
  defaultInfo: () => Effect.succeed(agentInfo),
  defaultAgent: () => Effect.succeed("code"),
  requirementStatus: () =>
    Effect.succeed({
      agent: "code",
      directory: "",
      enabled: false,
      state: "ready",
      skills: [],
      mcps: [],
      vscode_extensions: [],
    }),
  guardRequirements: () => Effect.void,
  generate: () => Effect.succeed({ identifier: "code", whenToUse: "", systemPrompt: "" }),
})

const truncate = Truncate.Service.of({
  cleanup: () => Effect.void,
  write: () => Effect.succeed(""),
  output: (text) => Effect.succeed({ content: text as string, truncated: false }),
  limits: () => Effect.succeed({ maxLines: Truncate.MAX_LINES, maxBytes: Truncate.MAX_BYTES }),
})

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "call_test",
  agent: "code",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const status = spyOn(KiloSessions, "remoteStatus")

beforeEach(() => {
  status.mockReturnValue({ enabled: true, connected: true })
})

afterEach(() => {
  status.mockReset()
})

function runNotifyTool(params: { readonly message: string }, sessions: KiloSessions.Interface) {
  const layer = Layer.mergeAll(
    Layer.succeed(KiloSessions.Service, KiloSessions.Service.of(sessions)),
    Layer.succeed(Agent.Service, agents),
    Layer.succeed(Truncate.Service, truncate),
  )
  return Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* NotifyUserTool
      const tool = yield* result.init()
      return yield* tool.execute(params, ctx)
    }).pipe(Effect.provide(layer)),
  )
}

describe("notify_user tool", () => {
  test("is only available while remote is enabled", () => {
    const tool = { id: "notify_user" } as Tool.Def
    status.mockReturnValue({ enabled: false, connected: false })
    expect(KiloToolRegistry.available(tool, agentInfo)).toBe(false)

    status.mockReturnValue({ enabled: true, connected: false })
    expect(KiloToolRegistry.available(tool, agentInfo)).toBe(true)
  })

  test("registers with id and description", async () => {
    const layer = Layer.mergeAll(
      Layer.succeed(KiloSessions.Service, KiloSessions.Service.of({
        init: () => Effect.void,
        sendAgentNotification: () => Effect.succeed({ ok: true }),
      })),
      Layer.succeed(Agent.Service, agents),
      Layer.succeed(Truncate.Service, truncate),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const info = yield* NotifyUserTool
        const tool = yield* info.init()
        return { id: info.id, description: tool.description }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.id).toBe("notify_user")
    expect(result.description).toContain("Send a push notification to the user's phone")
    expect(result.description).toContain("Do NOT use this tool")
  })

  test("rejects empty message", async () => {
    await expect(runNotifyTool({ message: "" }, {
      init: () => Effect.void,
      sendAgentNotification: () => Effect.succeed({ ok: true }),
    })).rejects.toBeDefined()
  })

  test("rejects whitespace-only message", async () => {
    await expect(runNotifyTool({ message: "   \n  " }, {
      init: () => Effect.void,
      sendAgentNotification: () => Effect.succeed({ ok: true }),
    })).rejects.toBeDefined()
  })

  test("rejects message over 500 chars", async () => {
    await expect(runNotifyTool({ message: "x".repeat(501) }, {
      init: () => Effect.void,
      sendAgentNotification: () => Effect.succeed({ ok: true }),
    })).rejects.toBeDefined()
  })

  test("trims message before sending", async () => {
    const calls: { sessionID: string; input: { id: string; message: string } }[] = []
    const sessions = KiloSessions.Service.of({
      init: () => Effect.void,
      sendAgentNotification: (sessionID, input) =>
        Effect.sync(() => {
          calls.push({ sessionID, input })
          return { ok: true }
        }),
    })

    const result = await runNotifyTool({ message: "  hello world  " }, sessions)

    expect(calls).toHaveLength(1)
    expect(calls[0].input.message).toBe("hello world")
    expect(result.metadata.ok).toBe(true)
    expect(result.output).toContain("Notification sent")
  })

  test("returns failure text when not connected", async () => {
    const sessions = KiloSessions.Service.of({
      init: () => Effect.void,
      sendAgentNotification: () => Effect.succeed({ ok: false, reason: "not_connected" }),
    })

    const result = await runNotifyTool({ message: "hello" }, sessions)

    expect(result.metadata.ok).toBe(false)
    expect(result.output).toContain("not connected to Kilo cloud")
  })

  test("does not send when remote is disabled", async () => {
    status.mockReturnValue({ enabled: false, connected: false })
    const sessions = KiloSessions.Service.of({
      init: () => Effect.void,
      sendAgentNotification: () => Effect.succeed({ ok: true }),
    })
    const send = spyOn(sessions, "sendAgentNotification")

    const result = await runNotifyTool({ message: "hello" }, sessions)

    expect(result.metadata.reason).toBe("not_connected")
    expect(send).not.toHaveBeenCalled()
    send.mockRestore()
  })

  test("returns failure text with arbitrary reason", async () => {
    const sessions = KiloSessions.Service.of({
      init: () => Effect.void,
      sendAgentNotification: () => Effect.succeed({ ok: false, reason: "http_500" }),
    })

    const result = await runNotifyTool({ message: "hello" }, sessions)

    expect(result.metadata.ok).toBe(false)
    expect(result.output).toContain("http_500")
  })

  test("returns failure text when not bootstrapped", async () => {
    const sessions = KiloSessions.Service.of({
      init: () => Effect.void,
      sendAgentNotification: () => Effect.succeed({ ok: false, reason: "not_bootstrapped" }),
    })

    const result = await runNotifyTool({ message: "hello" }, sessions)

    expect(result.metadata.ok).toBe(false)
    expect(result.metadata.reason).toBe("not_bootstrapped")
    expect(result.output).toContain("not_bootstrapped")
    expect(result.title).toBe("Notification unavailable")
  })

  test("returns failure text on bootstrap timeout", async () => {
    const sessions = KiloSessions.Service.of({
      init: () => Effect.void,
      sendAgentNotification: () => Effect.succeed({ ok: false, reason: "bootstrap_timeout" }),
    })

    const result = await runNotifyTool({ message: "hello" }, sessions)

    expect(result.metadata.ok).toBe(false)
    expect(result.metadata.reason).toBe("bootstrap_timeout")
    expect(result.output).toContain("bootstrap_timeout")
  })

  test("2xx success returns ok metadata and success output", async () => {
    const sessions = KiloSessions.Service.of({
      init: () => Effect.void,
      sendAgentNotification: () => Effect.succeed({ ok: true }),
    })

    const result = await runNotifyTool({ message: "ping" }, sessions)

    expect(result.metadata.ok).toBe(true)
    expect(result.metadata.notificationId).toBeDefined()
    expect(result.output).toContain("Notification sent")
    expect(result.title).toBe("Notification sent")
  })
})
