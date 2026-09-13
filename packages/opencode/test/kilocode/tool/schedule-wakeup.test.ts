import { describe, expect, test } from "bun:test"
import fs from "fs"
import { rm } from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Agent } from "@/agent/agent"
import { InstanceRef } from "@/effect/instance-ref"
import { Git } from "@/git"
import { Wakeup } from "@/kilocode/wakeup"
import { ScheduleWakeupTool, type Meta, Params } from "@/kilocode/tool/schedule-wakeup"
import { MessageID, SessionID } from "@/session/schema"
import { Storage } from "@/storage/storage"
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

const fire = Layer.succeed(Wakeup.Fire, Wakeup.Fire.of({ run: () => Effect.void }))

function makeLayer(dir: string) {
  const storage = Storage.layerFromDir(path.join(dir, "storage")).pipe(
    Layer.provide(LayerNode.compile(LayerNode.group([FSUtil.node, Git.node]))),
  )
  return Layer.mergeAll(
    Layer.succeed(InstanceRef, { directory: dir, worktree: dir, project: {} as any }),
    Wakeup.layer.pipe(Layer.provide(Layer.merge(storage, fire))),
    Layer.succeed(Agent.Service, agents),
    Layer.succeed(Truncate.Service, truncate),
  )
}

type ToolDef = Tool.DefWithoutID<typeof Params, Meta>

/** The success shape: a scheduled wakeup carries id, dueAt, and prompt. */
function scheduled(result: { metadata: Meta; output: string }) {
  const { id, dueAt, prompt } = result.metadata
  if (id === undefined || dueAt === undefined || prompt === undefined) {
    throw new Error(`expected a scheduled wakeup, got: ${result.output}`)
  }
  return { id, dueAt, prompt }
}

/** Build the tool against a fresh, isolated Wakeup service and run one body. */
async function run<T>(
  fn: (tool: ToolDef, wake: Wakeup.Interface, dir: string, info: Tool.Info<typeof Params, Meta>) => Effect.Effect<T>,
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-schedule-wakeup-"))
  try {
    return await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* Wakeup.Service
        const info = yield* ScheduleWakeupTool
        const tool = yield* info.init()
        return yield* fn(tool, wake, dir, info)
      }).pipe(Effect.provide(makeLayer(dir))),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe("schedule_wakeup tool", () => {
  test("registers as schedule_wakeup with when-not-to-use guidance", () =>
    run((tool, _wake, _dir, info) =>
      Effect.gen(function* () {
        expect(info.id).toBe("schedule_wakeup")
        expect(tool.description).toContain(
          "Do NOT use this tool for short waits that a blocking shell command covers",
        )
        expect(tool.description).toContain("10 seconds")
      }),
    ))

  test("schedules a wakeup and reports the id, due time, and prompt", () =>
    run((tool, wake, _dir) =>
      Effect.gen(function* () {
        const before = Date.now()

        const result = yield* tool.execute({ prompt: "check the deploy", delay: "5m", reason: "deploy" }, ctx)

        const { id, dueAt, prompt } = scheduled(result)
        expect(id).toMatch(/^wku/)
        expect(result.output).toContain(id)
        expect(result.output).toContain(new Date(dueAt).toISOString())
        expect(result.output).toContain("check the deploy")
        expect(dueAt).toBeGreaterThanOrEqual(before + 5 * 60_000)
        expect(prompt).toBe("check the deploy")

        const list = yield* wake.list({ sessionID: ctx.sessionID })
        expect(list).toHaveLength(1)
        expect(list[0]?.prompt).toBe("check the deploy")
        expect(result.output).not.toContain("Requested")
      }),
    ))

  test("accepts an absolute when and resolves it to the due time", () =>
    run((tool, _wake, _dir) =>
      Effect.gen(function* () {
        const when = new Date(Date.now() + 60 * 60_000)

        const result = yield* tool.execute({ prompt: "later", when: when.toISOString() }, ctx)

        const { dueAt } = scheduled(result)
        expect(result.title).toMatch(/^Scheduled wakeup wku/)
        expect(dueAt).toBeGreaterThanOrEqual(when.getTime() - 2_000)
        expect(result.output).toContain(when.toISOString())
      }),
    ))

  test("returns an Invalid wakeup input result for a past when", () =>
    run((tool, wake, _dir) =>
      Effect.gen(function* () {
        const result = yield* tool.execute(
          { prompt: "too late", when: new Date(Date.now() - 60_000).toISOString() },
          ctx,
        )

        expect(result.title).toBe("Invalid wakeup input")
        expect(result.metadata.id).toBeUndefined()
        expect(yield* wake.list({ sessionID: ctx.sessionID })).toEqual([])
      }),
    ))

  test("returns an Invalid wakeup input result when neither when nor delay is given", () =>
    run((tool, _wake, _dir) =>
      Effect.gen(function* () {
        const result = yield* tool.execute({ prompt: "when?" }, ctx)

        expect(result.title).toBe("Invalid wakeup input")
        expect(result.output).toContain("exactly one of when or delay")
      }),
    ))

  test("clamps a sub-minimum delay up to the minimum", () =>
    run((tool, _wake, _dir) =>
      Effect.gen(function* () {
        const before = Date.now()

        const result = yield* tool.execute({ prompt: "soon", delay: "1s" }, ctx)

        const { dueAt } = scheduled(result)
        const ahead = dueAt - before
        expect(ahead).toBeGreaterThanOrEqual(Wakeup.MIN_DELAY_MS)
        expect(ahead).toBeLessThan(Wakeup.MIN_DELAY_MS + 5_000)
        expect(result.output).toContain(`Requested delay: "1s" is under the 10-second minimum`)
      }),
    ))

  test("clamps a beyond-horizon when down to the horizon", () =>
    run((tool, _wake, _dir) =>
      Effect.gen(function* () {
        const before = Date.now()

        const result = yield* tool.execute(
          { prompt: "far", when: new Date(Date.now() + Wakeup.MAX_HORIZON_MS * 2).toISOString() },
          ctx,
        )

        const { dueAt } = scheduled(result)
        expect(dueAt - before).toBeLessThanOrEqual(Wakeup.MAX_HORIZON_MS + 2_000)
        expect(result.output).toContain("Requested when:")
        expect(result.output).toContain("7-day horizon")
      }),
    ))

  test("reports the cap when the session already holds the maximum", () =>
    run((tool, _wake, _dir) =>
      Effect.gen(function* () {
        for (let i = 0; i < Wakeup.MAX_PER_SESSION; i++) {
          const result = yield* tool.execute({ prompt: `wakeup ${i}`, delay: "1m" }, ctx)
          expect(result.metadata.id).toBeString()
        }

        const result = yield* tool.execute({ prompt: "one more", delay: "1m" }, ctx)

        expect(result.title).toBe("Too many scheduled wakeups")
        expect(result.output).toContain("Too many scheduled wakeups")
        expect(result.output).toContain(`maximum of ${Wakeup.MAX_PER_SESSION} pending wakeups`)
        expect(result.output).toContain("cancel_wakeup")
        expect(result.metadata.id).toBeUndefined()
      }),
    ))
})
