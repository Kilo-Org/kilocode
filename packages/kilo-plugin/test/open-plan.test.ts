import { expect, test } from "bun:test"
import { SessionStore } from "@opencode/core/session/store"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { Effect, Layer } from "effect"
import { rm } from "node:fs/promises"
import path from "node:path"
import { host } from "../../core/test/plugin/host"
import { openPlan, planExit } from "../src/plan/plan"
import { created, plan, sessionID, workspace } from "./plan-harness"

const session = { id: sessionID, time: { created, updated: created } } as unknown as Session.Info
const context = {
  sessionID,
  agent: plan,
  messageID: SessionMessage.ID.create(),
  id: Tool.CallID.make("call-plan"),
  progress: () => Effect.void,
}

async function run<A>(effect: (space: Awaited<ReturnType<typeof workspace>>, store: SessionStore.Interface) => Effect.Effect<A, unknown>) {
  const space = await workspace()
  try {
    return await Effect.runPromise(
      Effect.gen(function* () {
        return yield* effect(space, yield* SessionStore.Service)
      }).pipe(
        Effect.provide(
          Layer.mock(SessionStore.Service, { get: () => Effect.succeed(session), messages: () => Effect.succeed([]) }),
        ),
      ),
    )
  } finally {
    await space.dispose()
  }
}

const ctx = (space: Awaited<ReturnType<typeof workspace>>) =>
  host({ location: space.location, permission: { assert: () => Effect.void } as never })

test("plan_exit records the saved plan with the generated name", async () => {
  const result = await run((space, store) => planExit(ctx(space), store, space.data).execute({}, context))
  expect(result).toEqual({
    output: "Plan is ready at .kilo2/plans/1000-dark-mode-plan.md. Ending planning turn.",
    metadata: { plan: ".kilo2/plans/1000-dark-mode-plan.md" },
  })
})

test("open_plan asks the client to open the plan once", async () => {
  const result = await run((space, store) => openPlan(ctx(space), store, space.data).execute({}, context))
  expect(result.metadata).toEqual({ plan: ".kilo2/plans/1000-dark-mode-plan.md", open: true })
})

test("plan_exit fails with guidance when no plan file was written", async () => {
  const error = await run((space, store) =>
    Effect.gen(function* () {
      yield* Effect.promise(() => rm(path.join(space.project, ".kilo2", "plans"), { recursive: true }))
      return yield* planExit(ctx(space), store, space.data)
        .execute({ path: path.join(space.root, "outside.md") }, context)
        .pipe(Effect.flip)
    }),
  )
  expect(error).toBeInstanceOf(Tool.Error)
  expect((error as Tool.Error).message).toContain("cannot be used directly because it is outside the project")
})
