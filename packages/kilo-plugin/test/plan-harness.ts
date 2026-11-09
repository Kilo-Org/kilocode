import { Bus } from "@opencode/core/bus"
import { Form } from "@opencode/core/form"
import { Generate } from "@opencode/core/generate"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionStore } from "@opencode/core/session/store"
import type { Plugin } from "@opencode/plugin/effect"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Session } from "@opencode/schema/session"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { TuiEvent } from "@opencode/schema/tui-event"
import { Global } from "@opencode/util/global"
import { DateTime, Effect, Layer } from "effect"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { host } from "../../core/test/plugin/host"
import { KiloPlanPlugin } from "../src/plan"

export const sessionID = Session.ID.make("ses_plan_handoff_test")
export const nextSessionID = Session.ID.make("ses_plan_new_test")
export const plan = Agent.ID.make("plan")
export const code = Agent.ID.make("code")
export const created = DateTime.makeUnsafe(1_000)
export const planPath = ".kilo2/plans/1000-dark-mode-plan.md"

/** A temporary project with version control, a Kilo data directory and the session's plan file. */
export async function workspace() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-plan-")))
  const project = path.join(root, "project")
  const data = path.join(root, "data")
  await mkdir(path.join(project, ".kilo2", "plans"), { recursive: true })
  await Bun.write(path.join(project, planPath), "# Dark mode\n1. Add a toggle.")
  const location = new Location.Info({
    directory: AbsolutePath.make(project),
    project: {
      id: Project.ID.make("prj_plan_test"),
      directory: AbsolutePath.make(project),
      canonical: AbsolutePath.make(project),
    },
  })
  return { root, project, data, location, dispose: () => rm(root, { recursive: true, force: true }) }
}

function tool(name: string, metadata: Record<string, unknown>): SessionMessage.AssistantTool {
  return {
    type: "tool",
    id: Tool.CallID.make(`call-${name}`),
    name,
    time: { created },
    state: { status: "completed", input: {}, content: [{ type: "text", text: "done" }], metadata: metadata as Record<string, never> },
  }
}

/**
 * One planning turn ends: the idle hook runs twice for the same turn, and the form answers with `answer`.
 * Returns what the plugin did.
 */
export async function handoff(input: {
  answer?: string
  exit?: boolean
  exitAgent?: Agent.ID
  todos?: unknown[]
  handover?: string | Generate.UnavailableError
}) {
  const space = await workspace()
  const user: SessionMessage.Info = { id: SessionMessage.ID.create(), time: { created }, type: "user", text: "Plan dark mode" }
  const assistant: SessionMessage.Info = {
    id: SessionMessage.ID.create(),
    time: { created },
    type: "assistant",
    agent: input.exitAgent ?? plan,
    model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test") },
    content: [
      { type: "text", text: "The plan is ready." },
      ...(input.todos ? [tool("todowrite", { todos: input.todos })] : []),
      ...(input.exit === false ? [] : [tool("plan_exit", { plan: planPath })]),
    ],
  }
  const messages = [user, assistant]
  const session = { id: sessionID, agent: code, time: { created, updated: created } } as unknown as Session.Info
  const next = { id: nextSessionID, agent: code, time: { created, updated: created } } as unknown as Session.Info

  const asked: Form.CreateInput[] = []
  const switched: Agent.ID[] = []
  const createdAgents: (Agent.ID | undefined)[] = []
  const published: Session.ID[] = []
  const prompted: { sessionID: Session.ID; text: string }[] = []
  const generated: Generate.TextInput[] = []
  let idle: ((input: { sessionID: Session.ID; background: readonly unknown[] }) => Effect.Effect<void>) | undefined

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* KiloPlanPlugin.effect(
            host({
              location: space.location,
              agent: { ...host().agent, get: () => Effect.fail(new Error("no compaction agent")) } as Plugin.Context["agent"],
              tool: {
                transform: () => Effect.succeed({ dispose: Effect.void }),
                hook: () => Effect.succeed({ dispose: Effect.void }),
                reload: () => Effect.void,
                list: () => Effect.succeed([]),
              },
              session: {
                hook: ((name: string, callback: NonNullable<typeof idle>) => {
                  if (name === "experimental.idle") idle = callback
                  return Effect.succeed({ dispose: Effect.void })
                }) as never,
                switchAgent: (request) => Effect.sync(() => void switched.push(request.agent)),
                create: ((request: { agent?: Agent.ID }) =>
                  Effect.sync(() => {
                    createdAgents.push(request.agent)
                    return next
                  })) as never,
                prompt: (request) =>
                  Effect.sync(() => {
                    prompted.push({ sessionID: request.sessionID, text: request.text })
                    return {
                      id: SessionMessage.ID.create(),
                      sessionID: request.sessionID,
                      time: { created },
                      type: "user" as const,
                      payload: { text: request.text },
                      delivery: "steer" as const,
                    } satisfies SessionInbox.User
                  }),
              },
            }),
          )
          if (!idle) throw new Error("the plan plugin registered no idle hook")
          yield* idle({ sessionID, background: [] })
          yield* idle({ sessionID, background: [] })
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Global.Service, Global.make({ home: space.root, data: space.data })),
              Layer.mock(SessionStore.Service, {
                get: () => Effect.succeed(session),
                messages: (request) => {
                  if (request.type === "user") return Effect.succeed([user])
                  if (request.cursor) return Effect.succeed([assistant])
                  return Effect.succeed(request.order === "desc" ? messages.toReversed() : messages)
                },
              }),
              Layer.mock(Form.Service, {
                ask: (request) =>
                  Effect.sync(() => {
                    asked.push(request)
                    return { status: "answered" as const, answer: { q0: input.answer ?? "" } }
                  }),
              }),
              Layer.mock(Bus.Service, {
                publish: ((event: unknown, data: { sessionID: Session.ID }) =>
                  Effect.sync(() => {
                    if (event === TuiEvent.SessionSelect) published.push(data.sessionID)
                  })) as never,
              }),
              Layer.mock(Generate.Service, {
                text: (request) =>
                  Effect.suspend(() => {
                    generated.push(request)
                    return input.handover instanceof Generate.UnavailableError
                      ? Effect.fail(input.handover)
                      : Effect.succeed(input.handover ?? "")
                  }),
              }),
            ),
          ),
        ),
      ),
    )
  } finally {
    await space.dispose()
  }
  return { asked, switched, createdAgents, published, prompted, generated }
}
