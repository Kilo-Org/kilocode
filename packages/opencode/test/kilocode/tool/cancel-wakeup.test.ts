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
import { EventV2Bridge } from "@/event-v2-bridge"
import { Git } from "@/git"
import { Wakeup } from "@/kilocode/wakeup"
import { CancelWakeupTool, type Meta, Params } from "@/kilocode/tool/cancel-wakeup"
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
const events = Layer.mock(EventV2Bridge.Service, {
  publish: (definition, data) => Effect.succeed({ id: EventV2.ID.create(), type: definition.type, data }),
})

function makeLayer(dir: string) {
  const storage = Storage.layerFromDir(path.join(dir, "storage")).pipe(
    Layer.provide(LayerNode.compile(LayerNode.group([FSUtil.node, Git.node]))),
  )
  return Layer.mergeAll(
    Wakeup.layer.pipe(Layer.provide(Layer.mergeAll(storage, fire, events))),
    Layer.succeed(Agent.Service, agents),
    Layer.succeed(Truncate.Service, truncate),
  )
}

type ToolDef = Tool.DefWithoutID<typeof Params, Meta>

/** Build the tool against a fresh, isolated Wakeup service and run one body. */
async function run<T>(fn: (tool: ToolDef, wake: Wakeup.Interface, dir: string) => Effect.Effect<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-cancel-wakeup-"))
  try {
    return await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* Wakeup.Service
        const info = yield* CancelWakeupTool
        const tool = yield* info.init()
        return yield* fn(tool, wake, dir)
      }).pipe(Effect.provide(makeLayer(dir))),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const schedule = (wake: Wakeup.Interface, dir: string, delay = "1m") =>
  wake.schedule({ sessionID: ctx.sessionID, directory: dir, prompt: "check the build", delay }).pipe(Effect.orDie)

describe("cancel_wakeup tool", () => {
  test("describes the list as showing the reason, not the raw prompt", () =>
    run((tool) =>
      Effect.gen(function* () {
        expect(tool.description).toContain("reason")
      }),
    ))

  test("lists no wakeups on an empty store", () =>
    run((tool) =>
      Effect.gen(function* () {
        const result = yield* tool.execute({ action: "list" }, ctx)

        expect(result.title).toBe("Scheduled wakeups")
        expect(result.output).toBe("No pending wakeups for this session.")
        expect(result.metadata.count).toBe(0)
      }),
    ))

  test("lists a scheduled wakeup by id, due time, and prompt", () =>
    run((tool, wake, dir) =>
      Effect.gen(function* () {
        const info = yield* schedule(wake, dir)

        const result = yield* tool.execute({ action: "list" }, ctx)

        expect(result.output).toContain(info.id)
        expect(result.output).toContain(new Date(info.dueAt).toISOString())
        expect(result.output).toContain("check the build")
        expect(result.metadata.count).toBe(1)
      }),
    ))

  test("cancels a pending wakeup and reports its id", () =>
    run((tool, wake, dir) =>
      Effect.gen(function* () {
        const info = yield* schedule(wake, dir)

        const result = yield* tool.execute({ action: "cancel", id: info.id }, ctx)

        expect(result.output).toBe(`Cancelled wakeup ${info.id} (${new Date(info.dueAt).toISOString()}).`)
        expect(yield* wake.list({ sessionID: ctx.sessionID })).toEqual([])
      }),
    ))

  test("reports an already-gone wakeup without erroring", () =>
    run((tool, wake, dir) =>
      Effect.gen(function* () {
        const info = yield* schedule(wake, dir)
        yield* tool.execute({ action: "cancel", id: info.id }, ctx)

        const again = yield* tool.execute({ action: "cancel", id: info.id }, ctx)

        expect(again.output).toBe(`No pending wakeup with id ${info.id}.`)
        expect(again.metadata.cancelled).toBeUndefined()
      }),
    ))

  test("rejects cancel without an id", async () => {
    await expect(
      run((tool) =>
        Effect.gen(function* () {
          return yield* tool.execute({ action: "cancel" }, ctx)
        }),
      ),
    ).rejects.toBeDefined()
  })
})
