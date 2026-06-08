import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { PlanFile } from "../../src/kilocode/plan-file"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { Session } from "../../src/session/session"
import { MessageID } from "../../src/session/schema"
import { PlanExitTool } from "../../src/tool/plan"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { tmpdir } from "../fixture/fixture"

const rt = ManagedRuntime.make(Layer.mergeAll(Agent.defaultLayer, Session.defaultLayer, Truncate.defaultLayer))

async function init() {
  return rt.runPromise(
    Effect.gen(function* () {
      const info = yield* PlanExitTool
      return yield* Tool.init(info)
    }),
  )
}

describe("PlanFile", () => {
  test("plan_exit accepts custom paths from plan agent", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await rt.runPromise(Session.Service.use((svc) => svc.create({})))
        const tool = await init()
        const result = await rt.runPromise(
          tool.execute(
            { path: ".plans/fix.md" },
            {
              sessionID: session.id,
              messageID: MessageID.make("msg_plan_exit"),
              agent: "plan",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          ),
        )

        expect(result.metadata.plan.replaceAll(path.sep, "/")).toBe(".plans/fix.md")
        expect(result.output.replaceAll(path.sep, "/")).toContain(".plans/fix.md")
      },
    })
  })

  test("rejects custom plan paths outside the worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(PlanFile.resolve("../../etc/shadow", Instance.current)).toBeUndefined()
        expect(PlanFile.resolve("/tmp/evil.md", Instance.current)).toBeUndefined()
        expect(PlanFile.resolve(".plans/fix.md", Instance.current)).toBe(
          path.join(Instance.worktree, ".plans", "fix.md"),
        )
      },
    })
  })
})
