import { expect, test } from "bun:test"
import { Message, ToolFailure } from "@opencode/ai/effect"
import { Permission } from "@opencode/core/permission"
import { SessionStore } from "@opencode/core/session/store"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import type { SessionEvent } from "@opencode/schema/session-event"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { DateTime, Effect, Layer, PubSub, Stream } from "effect"
import fs from "node:fs"
import path from "node:path"
import { host } from "../../core/test/plugin/host"
import { PlanMode } from "../src/plan/mode"
import { created, plan, sessionID, workspace } from "./plan-harness"

type Context = { agent: Agent.ID; sessionID: Session.ID; messages: Message[] }
type After = { agent: Agent.ID; tool: string; status: "error"; error: unknown }

/** Installs Plan mode with captured hooks and returns them with the persisted reminders. */
async function install(run: (input: {
  context: (event: Context) => Effect.Effect<void>
  after: (event: After) => Effect.Effect<void>
  events: PubSub.PubSub<SessionEvent.Created | SessionEvent.AgentSelected>
  persisted: string[]
  dir: string
}) => Effect.Effect<void>, document = false) {
  const space = await workspace()
  const persisted: string[] = []
  const session = { id: sessionID, time: { created, updated: created } } as unknown as Session.Info
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const events = yield* PubSub.unbounded<SessionEvent.Created | SessionEvent.AgentSelected>()
          let context: ((event: Context) => Effect.Effect<void>) | undefined
          let after: ((event: After) => Effect.Effect<void>) | undefined
          const store = yield* SessionStore.Service
          yield* PlanMode.install({
            store,
            data: space.data,
            document,
            ctx: host({
              location: space.location,
              event: { subscribe: () => Stream.fromPubSub(events) as never },
              tool: {
                ...host().tool,
                hook: ((name: string, callback: NonNullable<typeof after>) => {
                  if (name === "execute.after") after = callback
                  return Effect.succeed({ dispose: Effect.void })
                }) as never,
              },
              session: {
                hook: ((name: string, callback: NonNullable<typeof context>) => {
                  if (name === "context") context = callback
                  return Effect.succeed({ dispose: Effect.void })
                }) as never,
                synthetic: (input) =>
                  Effect.sync(() => {
                    persisted.push(input.text)
                    return SessionInbox.Synthetic.make({
                      id: SessionMessage.ID.create(),
                      sessionID,
                      time: { created: DateTime.makeUnsafe(0) },
                      type: "synthetic",
                      payload: { text: input.text },
                      delivery: "steer",
                    })
                  }),
              },
            }),
          })
          if (!context || !after) throw new Error("Plan mode registered no hooks")
          yield* run({ context, after, events, persisted, dir: path.join(space.project, ".kilo2", "plans") })
        }).pipe(Effect.provide(Layer.mock(SessionStore.Service, { get: () => Effect.succeed(session) }))),
      ),
    )
  } finally {
    await space.dispose()
  }
  return persisted
}

const waitFor = (persisted: string[], count: number) =>
  Effect.promise(async () => {
    for (let i = 0; i < 1000 && persisted.length < count; i++) await Bun.sleep(1)
  })

test("a Plan request gets one Kilo Plan reminder that names the plan file, and the plan directory exists", async () => {
  const persisted = await install(({ context, dir }) =>
    Effect.gen(function* () {
      const event: Context = { agent: plan, sessionID, messages: [Message.user("Plan dark mode")] }
      yield* context(event)
      yield* context(event)
      expect(event.messages).toHaveLength(2)
      expect(fs.statSync(dir).isDirectory()).toBe(true)
    }),
  )
  expect(persisted).toHaveLength(1)
  expect(persisted[0]).toContain("You are Kilo Code, an experienced technical leader")
  expect(persisted[0]).toMatch(/otherwise create it in \S+\.kilo2[\\/]plans\. For generated/)
  expect(persisted[0]).toContain("1000-<concise-kebab-case-suffix>.md")
  expect(persisted[0]).not.toContain(".opencode")
  expect(persisted[0]).not.toContain("open_plan")
})

test("the VS Code client is told to open the plan before plan_exit", async () => {
  const persisted = await install(({ context }) => context({ agent: plan, sessionID, messages: [] }), true)
  expect(persisted[0]).toContain("call open_plan with the saved path before calling plan_exit")
})

test("leaving Plan adds the leave reminder once, and entering Plan adds the Plan reminder", async () => {
  const persisted = await install(({ context, events, persisted }) =>
    Effect.gen(function* () {
      const event: Context = { agent: plan, sessionID, messages: [Message.user("Plan dark mode")] }
      yield* context(event)
      const code: Context = { agent: Agent.ID.make("code"), sessionID, messages: event.messages }
      yield* context(code)
      yield* context(code)
      yield* PubSub.publish(events, {
        type: "session.agent.selected",
        data: { sessionID, agent: plan, previous: Agent.ID.make("code") },
      } as unknown as SessionEvent.AgentSelected)
      yield* waitFor(persisted, 3)
    }),
  )
  expect(persisted.map((text) => (text === PlanMode.leave ? "leave" : "enter"))).toEqual(["enter", "leave", "enter"])
})

test("a blocked plan edit explains the plan directory", async () => {
  await install(({ after, dir }) =>
    Effect.gen(function* () {
      const event: After = {
        agent: plan,
        tool: "write",
        status: "error",
        error: new Tool.Error({
          message: "blocked",
          error: new Permission.BlockedError({ rules: [], permission: "edit", resources: ["src/a.ts"] }),
        }),
      }
      yield* after(event)
      expect(event.error).toBeInstanceOf(ToolFailure)
      expect((event.error as ToolFailure).message).toBe(`Cannot use write to modify files outside the plan directory: ${dir}`)
    }),
  )
})

test("a plan directory that cannot be created does not fail the Plan request", async () => {
  const persisted = await install(({ context, dir }) =>
    Effect.gen(function* () {
      fs.mkdirSync(path.dirname(path.dirname(dir)), { recursive: true })
      fs.rmSync(path.dirname(dir), { recursive: true, force: true })
      fs.writeFileSync(path.dirname(dir), "not a directory")
      yield* context({ agent: plan, sessionID, messages: [Message.user("Plan dark mode")] })
    }),
  )
  expect(persisted).toHaveLength(1)
})
