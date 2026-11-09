import { expect, test } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Form } from "@opencode/core/form"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionStore } from "@opencode/core/session/store"
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
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { host } from "../../core/test/plugin/host"
import { KiloPlanPlugin } from "../src/plan"
import { PlanFile } from "../src/plan/plan-file"
import { PlanFollowup } from "../src/plan/plan-followup"

const sessionID = Session.ID.make("ses_plan_handoff_test")
const plan = Agent.ID.make("plan")
const code = Agent.ID.make("code")
const callID = Tool.CallID.make("call-plan-exit")
const created = DateTime.makeUnsafe(1_000)

const nextSessionID = Session.ID.make("ses_plan_new_test")

function expectQuestion(asked: Form.CreateInput | undefined) {
  expect(asked?.fields[0]).toMatchObject({ title: "Implement", description: "Ready to implement?" })
  expect(asked?.fields[0]?.type === "string" ? asked.fields[0].options?.map((option) => option.value) : []).toEqual([
    PlanFollowup.NEW_SESSION,
    PlanFollowup.CONTINUE,
    PlanFollowup.KEEP_REFINING,
  ])
  expect(asked?.metadata).toMatchObject({
    kilocode: {
      options: {
        q0: { [PlanFollowup.CONTINUE]: { mode: "code", labelKey: "plan.followup.answer.continue" } },
      },
    },
  })
}

/** One plan turn: the Plan agent writes the plan, calls plan_exit, the session is on Code, and the answer is given. */
async function run(answer: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-plan-handoff-"))
  const planFile = path.join(directory, ".kilo2", "plans", "1000-plan.md")
  // The session's selected agent changed after plan_exit; the part's agent is still Plan.
  const session = { id: sessionID, agent: code, time: { created } } as Session.Info
  const next = { id: nextSessionID, agent: code, time: { created } } as Session.Info
  const user: SessionMessage.Info = { id: SessionMessage.ID.create(), time: { created }, type: "user", text: "Create a plan" }
  let messages: SessionMessage.Info[] = [user]

  let added: Tool.Info | undefined
  let asked: Form.CreateInput | undefined
  let idle: ((input: { sessionID: Session.ID; background: readonly unknown[] }) => Effect.Effect<void>) | undefined
  let switched: Agent.ID | undefined
  let createdAgent: Agent.ID | undefined
  let published: Session.ID | undefined
  const prompted: { sessionID: Session.ID; text: string }[] = []

  try {
    await mkdir(path.dirname(planFile), { recursive: true })
    await Bun.write(planFile, "Do implementation step 1")

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* KiloPlanPlugin.effect(
            host({
              location: new Location.Info({
                directory: AbsolutePath.make(directory),
                project: {
                  id: Project.ID.global,
                  directory: AbsolutePath.make(directory),
                  canonical: AbsolutePath.make(directory),
                },
              }),
              permission: { assert: () => Effect.void } as never,
              tool: {
                transform: (callback) => {
                  callback({
                    add: (tool) => {
                      added = tool
                    },
                    update: () => {},
                    remove: () => {},
                    list: () => [],
                    get: () => undefined,
                    namespace: () => {},
                  })
                  return Effect.succeed({ dispose: Effect.void })
                },
                hook: () => Effect.succeed({ dispose: Effect.void }),
                reload: () => Effect.void,
                list: () => Effect.succeed([]),
              },
              session: {
                hook: ((
                  name: string,
                  callback: (input: { sessionID: Session.ID; background: readonly unknown[] }) => Effect.Effect<void>,
                ) => {
                  if (name === "experimental.idle") idle = callback
                  return Effect.succeed({ dispose: Effect.void })
                }) as never,
                switchAgent: (input) =>
                  Effect.sync(() => {
                    switched = input.agent
                  }),
                create: ((input: { agent?: Agent.ID }) =>
                  Effect.sync(() => {
                    createdAgent = input.agent
                    return next
                  })) as never,
                prompt: (input) =>
                  Effect.sync(() => {
                    prompted.push({ sessionID: input.sessionID, text: input.text })
                    return {
                      id: SessionMessage.ID.create(),
                      sessionID: input.sessionID,
                      time: { created },
                      type: "user" as const,
                      payload: { text: input.text },
                      delivery: "steer" as const,
                    } satisfies SessionInbox.User
                  }),
              },
            }),
          )

          if (!added) throw new Error("the plan plugin registered no plan_exit tool")
          const result = yield* added.execute({}, {
            sessionID,
            agent: plan,
            messageID: user.id,
            id: callID,
            progress: () => Effect.void,
          })
          expect(result.output).toBe("Plan is ready at .kilo2/plans/1000-plan.md. Ending planning turn.")
          expect(result.metadata).toEqual({ plan: ".kilo2/plans/1000-plan.md" })

          messages = [
            user,
            {
              id: SessionMessage.ID.create(),
              time: { created },
              type: "assistant",
              agent: plan,
              model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test") },
              content: [
                {
                  type: "tool",
                  id: callID,
                  name: "plan_exit",
                  time: { created },
                  state: {
                    status: "completed",
                    input: {},
                    content: [{ type: "text", text: result.output ?? "" }],
                    metadata: result.metadata as Record<string, never>,
                  },
                },
              ],
            },
          ]

          if (!idle) throw new Error("the plan plugin registered no idle hook")
          yield* idle({ sessionID, background: [] })
        }),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Global.Service, Global.make({ home: directory })),
            Layer.mock(SessionStore.Service, {
              get: () => Effect.succeed(session),
              messages: (input) =>
                Effect.succeed(input.type === "user" ? [user] : messages.filter((message) => message.type !== "user")),
            }),
            Layer.mock(Form.Service, {
              ask: (input) =>
                Effect.sync(() => {
                  asked = input
                  return { status: "answered" as const, answer: { q0: answer } }
                }),
            }),
            Layer.mock(Bus.Service, {
              publish: ((event: unknown, data: { sessionID: Session.ID }) =>
                Effect.sync(() => {
                  if (event === TuiEvent.SessionSelect) published = data.sessionID
                })) as never,
            }),
          ),
        ),
      ),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }

  return { asked, switched, createdAgent, published, prompted }
}

test("a plan_exit turn asks the follow-up after the session agent changes", async () => {
  const result = await run(PlanFollowup.CONTINUE)
  expectQuestion(result.asked)
  expect(result.switched).toBe(code)
  expect(result.prompted).toEqual([{ sessionID, text: "Implement the plan above." }])
})

test("Start new session creates, selects and prompts a new Code session", async () => {
  const result = await run(PlanFollowup.NEW_SESSION)
  expectQuestion(result.asked)
  expect(result.createdAgent).toBe(code)
  expect(result.published).toBe(nextSessionID)
  expect(result.prompted).toEqual([
    {
      sessionID: nextSessionID,
      text: "Plan file: .kilo2/plans/1000-plan.md\nRead this file first and treat it as the source of truth for implementation.",
    },
  ])
})

test("a plan in the native plan directory is accepted when the directory is a plan root", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "kilo-plan-project-"))
  const home = await mkdtemp(path.join(os.tmpdir(), "kilo-plan-home-"))
  try {
    const native = path.join(home, ".opencode", "plan", "1000-plan.md")
    await mkdir(path.dirname(native), { recursive: true })
    await Bun.write(native, "# Plan")
    const target = new Location.Info({
      directory: AbsolutePath.make(project),
      project: {
        id: Project.ID.global,
        directory: AbsolutePath.make(project),
        canonical: AbsolutePath.make(project),
      },
    })
    expect(PlanFile.resolve(native, target)).toBeUndefined()
    expect(PlanFile.resolve(native, target, target.directory, [path.dirname(native)])).toBe(native)
    expect(PlanFile.display(native, target)).toBe(native)
  } finally {
    await rm(project, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  }
})

test("a newer generated plan wins over a stale exact target", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "kilo-plan-stale-"))
  try {
    const target = path.join(project, ".kilo2", "plans", "1000-plan.md")
    const fresh = path.join(project, ".kilo2", "plans", "1000-refined.md")
    await mkdir(path.dirname(target), { recursive: true })
    await Bun.write(target, "Stale plan")
    await new Promise((resolve) => setTimeout(resolve, 20))
    await Bun.write(fresh, "Fresh plan")
    const workspace = new Location.Info({
      directory: AbsolutePath.make(project),
      project: {
        id: Project.ID.global,
        directory: AbsolutePath.make(project),
        canonical: AbsolutePath.make(project),
      },
    })
    expect(PlanFile.locate(target, [], workspace)).toBe(fresh)
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})

test("a subdirectory session displays the plan relative to its own workspace", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "kilo-plan-subdir-"))
  try {
    const directory = path.join(project, "packages", "app")
    const file = path.join(project, ".kilo2", "plans", "1000-plan.md")
    await mkdir(directory, { recursive: true })
    await mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, "# Plan")
    const workspace = new Location.Info({
      directory: AbsolutePath.make(directory),
      project: {
        id: Project.ID.global,
        directory: AbsolutePath.make(project),
        canonical: AbsolutePath.make(project),
      },
    })
    expect(PlanFile.display(file, workspace)).toBe("../../.kilo2/plans/1000-plan.md")
    expect(PlanFile.resolve("../../.kilo2/plans/1000-plan.md", workspace, workspace.directory)).toBe(file)
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})
