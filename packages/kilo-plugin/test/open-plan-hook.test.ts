import { expect, test } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { SessionStore } from "@opencode/core/session/store"
import { Session } from "@opencode/schema/session"
import { Global } from "@opencode/util/global"
import { Effect, Layer } from "effect"
import { host } from "../../core/test/plugin/host"
import { KiloPlanPlugin } from "../src/plan"
import { created, sessionID, workspace } from "./plan-harness"

const session = { id: sessionID, time: { created, updated: created } } as unknown as Session.Info
const planPath = ".kilo2/plans/1000-dark-mode-plan.md"

test("puts a Code Mode open_plan path on the execute result even when the model omits it", async () => {
  const space = await workspace()
  const hooks: Array<(event: never) => Effect.Effect<void>> = []
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* KiloPlanPlugin.effect(
            host({
              location: space.location,
              tool: {
                ...host().tool,
                transform: () => Effect.succeed({ dispose: Effect.void }),
                hook: ((name: string, callback: (event: never) => Effect.Effect<void>) => {
                  if (name === "execute.after") hooks.push(callback)
                  return Effect.succeed({ dispose: Effect.void })
                }) as never,
              },
              session: {
                ...host().session,
                hook: (() => Effect.succeed({ dispose: Effect.void })) as never,
              },
            }),
          )
          const event = {
            tool: "execute",
            status: "completed" as const,
            input: {},
            result: {
              content: [{ type: "text" as const, text: `Opened plan at ${planPath} for review.` }],
              metadata: { toolCalls: [{ tool: "open_plan", status: "completed", input: {} }] },
            },
          }
          for (const hook of hooks) yield* hook(event as never)
          expect(event.result.metadata).toMatchObject({ path: planPath, open: true })
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Global.Service, Global.make({ home: space.root, data: space.data })),
              Layer.mock(SessionStore.Service, {
                get: () => Effect.succeed(session),
                messages: () => Effect.succeed([]),
              }),
              Layer.mock(Bus.Service, { publish: () => Effect.void as never }),
            ),
          ),
        ),
      ),
    )
  } finally {
    await space.dispose()
  }
})
