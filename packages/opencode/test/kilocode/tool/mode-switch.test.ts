import { expect, test } from "bun:test"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { execute, modes, type Params } from "@/kilocode/tool/mode-switch"
import { KiloToolRegistry } from "@/kilocode/tool/registry"
import type { Agent } from "@/agent/agent"
import type * as Tool from "@/tool/tool"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Cause, Effect, Exit } from "effect"
import { permissionInfo } from "@/cli/cmd/run/permission.shared"
import type { PermissionRequest } from "@kilocode/sdk/v2"

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

function message(agent: string): SessionV1.WithParts {
  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent,
      model: {
        providerID: ProviderV2.ID.make("test"),
        modelID: ModelV2.ID.make("test"),
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
  answer?: string
  available?: Agent.Info[]
}) {
  const source = input.source ?? "code"
  const target = input.target ?? "debug"
  const updated: SessionV1.Info[] = []
  const switched: string[] = []
  const prompts: string[] = []
  const requests: Array<{ permission: string; metadata: Record<string, unknown> }> = []
  const available = input.available ?? [mode("code"), mode("debug"), mode("ask"), mode("plan")]
  const ctx = {
    sessionID,
    messageID,
    callID: "call_mode_switch",
    agent: source,
    messages: [message(source)],
  }
  const deps = {
    agents: {
      list: () => Effect.succeed(available),
      guardRequirements: () => Effect.void,
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
    question: {
      ask: (request: { questions: ReadonlyArray<{ question: string }> }) =>
        Effect.sync(() => {
          prompts.push(request.questions[0]?.question ?? "")
          return [[input.answer ?? "Continue current mode"]]
        }),
    },
    switched: (event: { agent: string }) =>
      Effect.sync(() => {
        switched.push(event.agent)
      }),
  }
  return {
    source,
    target,
    updated,
    switched,
    prompts,
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

test("denial requires explicit confirmation before continuing in the current mode", async () => {
  const item = fixture({
    ask: () => Effect.die(new Permission.DeniedError({ ruleset: [] })),
    answer: "Continue current mode",
  })

  const result = await item.run()
  expect(result.metadata.status).toBe("continued")
  expect(item.prompts[0]).toContain("Switching from code to debug was denied")
  expect(item.updated).toEqual([])
  expect(item.switched).toEqual([])
})

test("cancelling after denial stops the task", async () => {
  const item = fixture({
    ask: () => Effect.die(new Permission.DeniedError({ ruleset: [] })),
    answer: "Cancel task",
  })

  const result = await item.exit()
  expect(Exit.isFailure(result)).toBe(true)
  if (Exit.isFailure(result)) expect(Cause.squash(result.cause)).toBeInstanceOf(Question.RejectedError)
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
    if (err instanceof Error) expect(err.message).toContain("Available modes: debug")
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

test("the mode switch tool is visible only to built-in interactive modes", () => {
  const tool = { id: "mode_switch" } as Tool.Def
  expect(KiloToolRegistry.available(tool, mode("code"))).toBe(true)
  expect(KiloToolRegistry.available(tool, mode("custom", { native: false }))).toBe(false)
  expect(KiloToolRegistry.available(tool, mode("explore", { mode: "subagent" }))).toBe(false)
  expect(KiloToolRegistry.available(tool, mode("hidden", { hidden: true }))).toBe(false)
})
