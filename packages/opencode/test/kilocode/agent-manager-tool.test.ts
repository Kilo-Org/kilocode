import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { MessageID, SessionID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AgentManagerTool } from "../../src/kilocode/tool/agent-manager"
import { AgentManagerInspectTool } from "../../src/kilocode/tool/agent-manager-inspect"
import { AgentManagerControlBridge } from "../../src/kilocode/agent-manager/control"
import { AgentManagerInspectBridge } from "../../src/kilocode/agent-manager/inspect"
import { AgentManagerEvent } from "../../src/kilocode/agent-manager/event"
import { Bus } from "../../src/bus"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { Agent } from "../../src/agent/agent"

const runtime = ManagedRuntime.make(
  Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer, Bus.defaultLayer, CrossSpawnSpawner.defaultLayer),
)

async function init() {
  return runtime.runPromise(
    Effect.gen(function* () {
      const info = yield* AgentManagerTool
      return yield* Tool.init(info)
    }),
  )
}

async function initInspect() {
  return runtime.runPromise(
    Effect.gen(function* () {
      const info = yield* AgentManagerInspectTool
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

  test("asks for prompt control permission", async () => {
    const tool = await init()
    const calls: unknown[] = []

    const result = await runtime.runPromise(
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const bus = yield* Bus.Service
          const unsub = yield* bus.subscribeCallback(AgentManagerEvent.Control, (event) => {
            AgentManagerControlBridge.respond({
              requestID: event.properties.requestID,
              action: event.properties.action,
              applied: true,
              message: "ok",
              sessionID: event.properties.targetSessionID,
            })
          })
          return yield* tool
            .execute(
              { action: "prompt", sessionID: "ses_target", prompt: "Continue babysitting the PR" },
              { ...ctx, ask: (input: unknown) => Effect.sync(() => calls.push(input)) },
            )
            .pipe(Effect.ensuring(Effect.sync(unsub)))
        }),
      ).pipe(Effect.scoped),
    )

    expect(calls).toEqual([
      {
        permission: "agent_manager",
        patterns: ["prompt", "ses_target"],
        always: ["prompt"],
        metadata: { action: "prompt", target: "ses_target" },
      },
    ])
    expect(result.output).toContain("applied: true")
    expect(result.output).toContain("message: ok")
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

  test("rejects prompt without target session", async () => {
    const tool = await init()

    await expect(
      runtime.runPromise(
        provideTmpdirInstance(() =>
          tool.execute({ action: "prompt", prompt: "Continue" }, { ...ctx, ask: () => Effect.void }),
        ).pipe(Effect.scoped),
      ),
    ).rejects.toThrow("action=prompt requires sessionID")
  })

  test("rejects rename section without new name", async () => {
    const tool = await init()

    await expect(
      runtime.runPromise(
        provideTmpdirInstance(() =>
          tool.execute({ action: "rename_section", sectionName: "REVIEW" }, { ...ctx, ask: () => Effect.void }),
        ).pipe(Effect.scoped),
      ),
    ).rejects.toThrow("action=rename_section requires newSectionName")
  })

  test("rejects ungroup without target card", async () => {
    const tool = await init()

    await expect(
      runtime.runPromise(
        provideTmpdirInstance(() => tool.execute({ action: "ungroup" }, { ...ctx, ask: () => Effect.void })).pipe(
          Effect.scoped,
        ),
      ),
    ).rejects.toThrow("action=ungroup requires worktreeID or sessionID")
  })

  test("inspect asks for read-only inspect permission", async () => {
    const tool = await initInspect()
    const calls: unknown[] = []

    const result = await runtime.runPromise(
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const bus = yield* Bus.Service
          const unsub = yield* bus.subscribeCallback(AgentManagerEvent.Inspect, (event) => {
            AgentManagerInspectBridge.respond({ requestID: event.properties.requestID, output: "ok" })
          })
          return yield* tool
            .execute(
              { sessionID: "ses_target", tail: 3 },
              { ...ctx, ask: (input: unknown) => Effect.sync(() => calls.push(input)) },
            )
            .pipe(Effect.ensuring(Effect.sync(unsub)))
        }),
      ).pipe(Effect.scoped),
    )

    expect(calls).toEqual([
      {
        permission: "agent_manager",
        patterns: ["inspect", "ses_target"],
        always: ["inspect"],
        metadata: { action: "inspect", target: "ses_target" },
      },
    ])
    expect(result.output).toBe("ok")
  })
})
