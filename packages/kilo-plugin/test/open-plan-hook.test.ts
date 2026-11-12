import { expect, test } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { SessionStore } from "@opencode/core/session/store"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Global } from "@opencode/util/global"
import { Effect, Layer } from "effect"
import { host } from "../../core/test/plugin/host"
import { KiloPlanPlugin } from "../src/plan"
import { code, created, sessionID, workspace } from "./plan-harness"

const session = { id: sessionID, time: { created, updated: created } } as unknown as Session.Info
const planPath = ".kilo2/plans/1000-dark-mode-plan.md"

test("puts a Code Mode open_plan path on the execute result even when the model omits it", async () => {
  const space = await workspace()
  const hooks: Array<(event: never) => Effect.Effect<void>> = []
  const previous = process.env.OPENCODE_CLIENT
  process.env.OPENCODE_CLIENT = "vscode"
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
          const id = "call-execute"
          const messageID = SessionMessage.ID.create()
          const openEvent = {
            tool: "open_plan",
            status: "completed" as const,
            sessionID,
            agent: code,
            messageID,
            id,
            input: {},
            result: { metadata: { path: planPath, open: true } },
          }
          const executeEvent = {
            tool: "execute",
            status: "completed" as const,
            sessionID,
            agent: code,
            messageID,
            id,
            input: {},
            result: { content: [{ type: "text" as const, text: "done" }], metadata: { toolCalls: [] } },
          }
          for (const hook of hooks) yield* hook(openEvent as never)
          for (const hook of hooks) yield* hook(executeEvent as never)
          expect(executeEvent.result.metadata).toMatchObject({ path: planPath, open: true })
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
    if (previous === undefined) delete process.env.OPENCODE_CLIENT
    else process.env.OPENCODE_CLIENT = previous
    await space.dispose()
  }
})
