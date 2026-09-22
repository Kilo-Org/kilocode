import { describe, expect, test } from "bun:test"
import fs from "fs"
import { rm } from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Agent } from "@/agent/agent"
import { InstanceRef } from "@/effect/instance-ref"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Git } from "@/git"
import { Wakeup } from "@/kilocode/wakeup"
import {
  CronCreateTool,
  CronDeleteTool,
  CronListTool,
  type CronCreateMeta,
  type CronCreateParams,
  type CronDeleteMeta,
  type CronDeleteParams,
  type CronListMeta,
  type CronListParams,
} from "@/kilocode/tool/cron"
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

const other: Tool.Context = { ...ctx, sessionID: SessionID.make("ses_other") }

const fire = Layer.succeed(Wakeup.Fire, Wakeup.Fire.of({ run: () => Effect.void }))
const events = Layer.mock(EventV2Bridge.Service, {
  publish: (definition, data) => Effect.succeed({ id: EventV2.ID.create(), type: definition.type, data }),
})

function makeLayer(dir: string) {
  const storage = Storage.layerFromDir(path.join(dir, "storage")).pipe(
    Layer.provide(LayerNode.compile(LayerNode.group([FSUtil.node, Git.node]))),
  )
  return Layer.mergeAll(
    Layer.succeed(InstanceRef, { directory: dir, worktree: dir, project: {} as any }),
    Wakeup.layer.pipe(Layer.provide(Layer.mergeAll(storage, fire, events))),
    Layer.succeed(Agent.Service, agents),
    Layer.succeed(Truncate.Service, truncate),
  )
}

type Create = Tool.DefWithoutID<typeof CronCreateParams, CronCreateMeta>
type List = Tool.DefWithoutID<typeof CronListParams, CronListMeta>
type Delete = Tool.DefWithoutID<typeof CronDeleteParams, CronDeleteMeta>
type Tools = { create: Create; list: List; remove: Delete }

/** The success shape: a scheduled task carries id, dueAt, and prompt. */
function scheduled(result: { metadata: CronCreateMeta; output: string }) {
  const { id, dueAt, prompt } = result.metadata
  if (id === undefined || dueAt === undefined || prompt === undefined) {
    throw new Error(`expected a scheduled cron task, got: ${result.output}`)
  }
  return { id, dueAt, prompt }
}

/** Build the three tools against a fresh, isolated Wakeup service and run one body. */
async function run<T>(fn: (tools: Tools, wake: Wakeup.Interface) => Effect.Effect<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-cron-tool-"))
  try {
    return await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* Wakeup.Service
        const create = yield* CronCreateTool
        const list = yield* CronListTool
        const remove = yield* CronDeleteTool
        return yield* fn(
          { create: yield* create.init(), list: yield* list.init(), remove: yield* remove.init() },
          wake,
        )
      }).pipe(Effect.provide(makeLayer(dir))),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe("cron_create tool", () => {
  test("registers as cron_create and documents the limits", () =>
    run((tools) =>
      Effect.gen(function* () {
        expect(CronCreateTool.id).toBe("cron_create")
        expect(CronListTool.id).toBe("cron_list")
        expect(CronDeleteTool.id).toBe("cron_delete")

        expect(tools.create.description).toContain("one minute")
        expect(tools.create.description).toContain("seven days")
        expect(tools.create.description).toContain("schedule_wakeup")
        expect(tools.list.description).toContain("cron_delete")
        expect(tools.remove.description).toContain("already gone")
      }),
    ))

  test("schedules a recurring task and reports the expression, next fire, and prompt", () =>
    run((tools, wake) =>
      Effect.gen(function* () {
        const result = yield* tools.create.execute({ prompt: "poll the feed", cron: "*/5 * * * *" }, ctx)

        const { id, dueAt, prompt } = scheduled(result)
        expect(id).toMatch(/^wku/)
        expect(result.title).toBe(`Scheduled cron task ${id}`)
        expect(result.output).toContain("*/5 * * * *")
        expect(result.output).toContain(new Date(dueAt).toISOString())
        expect(result.output).toContain("poll the feed")
        expect(prompt).toBe("poll the feed")

        const list = yield* wake.cronList({ sessionID: ctx.sessionID })
        expect(list.map((task) => task.id)).toEqual([id])
        expect(list[0]?.recurring).toBe(true)
      }),
    ))

  test("schedules a one-shot task from a delay", () =>
    run((tools, wake) =>
      Effect.gen(function* () {
        const before = Date.now()

        const result = yield* tools.create.execute({ prompt: "one shot", delay: "5m" }, ctx)

        const { dueAt } = scheduled(result)
        expect(result.output).toContain("5m")
        expect(dueAt).toBeGreaterThanOrEqual(before + 5 * 60_000)
        const list = yield* wake.cronList({ sessionID: ctx.sessionID })
        expect(list[0]?.recurring).toBe(false)
      }),
    ))

  test("returns an Invalid cron schedule result for an invalid expression", () =>
    run((tools, wake) =>
      Effect.gen(function* () {
        const result = yield* tools.create.execute({ prompt: "nope", cron: "not a cron" }, ctx)

        expect(result.title).toBe("Invalid cron schedule")
        expect(result.output).toContain("Invalid cron expression")
        expect(result.metadata.id).toBeUndefined()
        expect(yield* wake.cronList({ sessionID: ctx.sessionID })).toEqual([])
      }),
    ))

  test("reports the resolve message for a past one-shot", () =>
    run((tools, wake) =>
      Effect.gen(function* () {
        const result = yield* tools.create.execute(
          { prompt: "too late", when: new Date(Date.now() - 60_000).toISOString() },
          ctx,
        )

        expect(result.title).toBe("Invalid cron input")
        expect(result.output).toContain("not in the future")
        expect(result.metadata.id).toBeUndefined()
        expect(yield* wake.cronList({ sessionID: ctx.sessionID })).toEqual([])
      }),
    ))

  test("rejects cron and when given together, and neither form", async () => {
    await expect(
      run((tools) =>
        Effect.gen(function* () {
          return yield* tools.create.execute(
            { prompt: "both", cron: "* * * * *", when: new Date(Date.now() + 60_000).toISOString() },
            ctx,
          )
        }),
      ),
    ).rejects.toBeDefined()

    await expect(
      run((tools) =>
        Effect.gen(function* () {
          return yield* tools.create.execute({ prompt: "none" }, ctx)
        }),
      ),
    ).rejects.toBeDefined()
  })

  test("reports the cap when the session already holds the maximum", () =>
    run((tools) =>
      Effect.gen(function* () {
        for (let i = 0; i < Wakeup.MAX_CRON_PER_SESSION; i++) {
          const result = yield* tools.create.execute({ prompt: `job ${i}`, cron: "*/5 * * * *" }, ctx)
          expect(result.metadata.id).toBeString()
        }

        const result = yield* tools.create.execute({ prompt: "one more", cron: "*/5 * * * *" }, ctx)

        expect(result.title).toBe("Too many cron tasks")
        expect(result.output).toContain(`maximum of ${Wakeup.MAX_CRON_PER_SESSION} scheduled tasks`)
        expect(result.output).toContain("cron_delete")
        expect(result.metadata.id).toBeUndefined()
      }),
    ))
})

describe("cron_list tool", () => {
  test("lists no tasks on an empty session", () =>
    run((tools) =>
      Effect.gen(function* () {
        const result = yield* tools.list.execute({}, ctx)

        expect(result.title).toBe("Scheduled cron tasks")
        expect(result.output).toBe("No scheduled cron tasks for this session.")
        expect(result.metadata.count).toBe(0)
      }),
    ))

  test("lists a task by id, schedule, next fire, and prompt", () =>
    run((tools, wake) =>
      Effect.gen(function* () {
        yield* tools.create.execute({ prompt: "check the feed", cron: "*/5 * * * *" }, ctx)
        const info = (yield* wake.cronList({ sessionID: ctx.sessionID }))[0]

        const result = yield* tools.list.execute({}, ctx)

        expect(result.output).toContain(info.id)
        expect(result.output).toContain(info.schedule)
        expect(result.output).toContain(new Date(info.dueAt).toISOString())
        expect(result.output).toContain("check the feed")
        expect(result.metadata.count).toBe(1)
      }),
    ))
})

describe("cron_delete tool", () => {
  test("deletes a task and reports an already-gone id without erroring", () =>
    run((tools, wake) =>
      Effect.gen(function* () {
        const created = yield* tools.create.execute({ prompt: "doomed", cron: "*/5 * * * *" }, ctx)
        const { id, dueAt } = scheduled(created)

        const result = yield* tools.remove.execute({ id }, ctx)
        expect(result.title).toBe("Deleted cron task")
        expect(result.output).toBe(`Deleted cron task ${id} (next ${new Date(dueAt).toISOString()}).`)
        expect(yield* wake.cronList({ sessionID: ctx.sessionID })).toEqual([])

        const again = yield* tools.remove.execute({ id }, ctx)
        expect(again.title).toBe("No cron task")
        expect(again.output).toBe(`No cron task with id ${id}.`)
        expect(again.metadata.deleted).toBeUndefined()
      }),
    ))

  test("does not delete another session's task", () =>
    run((tools, wake) =>
      Effect.gen(function* () {
        const created = yield* tools.create.execute({ prompt: "mine", cron: "*/5 * * * *" }, ctx)
        const { id } = scheduled(created)

        const result = yield* tools.remove.execute({ id }, other)

        expect(result.output).toBe(`No cron task with id ${id}.`)
        expect((yield* wake.cronList({ sessionID: ctx.sessionID })).map((task) => task.id)).toEqual([id])
      }),
    ))
})
