import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { PlanFile } from "../../src/kilocode/plan-file"
import { Instance } from "../../src/kilocode/instance"
import { provideTestInstance } from "../fixture/fixture"
import { Session } from "../../src/session/session"
import { MessageID, PartID } from "../../src/session/schema"
import { ProviderID, ModelID } from "../../src/provider/schema"
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
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await rt.runPromise(Session.Service.use((svc) => svc.create({})))
        const file = path.join(Instance.worktree, ".plans", "fix.md")
        await Bun.write(file, "Do implementation step 1")

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

  test("plan_exit recovers generated plan path when omitted", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await rt.runPromise(Session.Service.use((svc) => svc.create({ title: "wrong-name" })))
        const file = path.join(Instance.worktree, ".kilo", "plans", `${session.time.created}-xy.md`)
        await Bun.write(file, "Do implementation step 1")

        const tool = await init()
        const result = await rt.runPromise(
          tool.execute(
            {},
            {
              sessionID: session.id,
              messageID: MessageID.make("msg_plan_exit_generated"),
              agent: "plan",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          ),
        )

        expect(result.metadata.plan.replaceAll(path.sep, "/")).toBe(`.kilo/plans/${session.time.created}-xy.md`)
      },
    })
  })

  test("plan_exit prefers a newer generated plan over a stale file at the guessed path", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        const session = await rt.runPromise(Session.Service.use((svc) => svc.create({ title: "refined" })))
        const stale = Session.plan(session, ctx)
        await Bun.write(stale, "Stale plan from an earlier round")

        const fresh = path.join(path.dirname(stale), `${session.time.created}-refined-plan.md`)
        await new Promise((r) => setTimeout(r, 10))
        await Bun.write(fresh, "Fresh refined plan")

        const tool = await init()
        const result = await rt.runPromise(
          tool.execute(
            {},
            {
              sessionID: session.id,
              messageID: MessageID.make("msg_plan_exit_refined"),
              agent: "plan",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          ),
        )

        expect(result.metadata.plan).toBe(PlanFile.display(fresh, ctx))
      },
    })
  })

  test("plan_exit recovers custom-named plan file from write history", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const file = path.join(Instance.worktree, ".plans", "refactor-notes.md")
        await Bun.write(file, "Do implementation step 1")

        const session = await rt.runPromise(
          Session.Service.use((svc) =>
            Effect.gen(function* () {
              const info = yield* svc.create({ title: "custom-name" })
              const msg = yield* svc.updateMessage({
                id: MessageID.ascending(),
                role: "user",
                sessionID: info.id,
                time: { created: Date.now() },
                agent: "plan",
                model: { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-sonnet-5") },
              })
              yield* svc.updatePart({
                id: PartID.ascending(),
                messageID: msg.id,
                sessionID: info.id,
                type: "tool",
                callID: "call_write_plan",
                tool: "write",
                state: {
                  status: "completed",
                  input: { filePath: file, content: "Do implementation step 1" },
                  output: "",
                  title: "write",
                  metadata: {},
                  time: { start: Date.now(), end: Date.now() },
                },
              })
              return info
            }),
          ),
        )

        const tool = await init()
        const result = await rt.runPromise(
          tool.execute(
            {},
            {
              sessionID: session.id,
              messageID: MessageID.make("msg_plan_exit_history"),
              agent: "plan",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          ),
        )

        expect(result.metadata.plan.replaceAll(path.sep, "/")).toBe(".plans/refactor-notes.md")
      },
    })
  })

  test("plan_exit recovers generated plan path in non-git projects", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        const session = await rt.runPromise(Session.Service.use((svc) => svc.create({ title: "non-git" })))
        const file = Session.plan(session, ctx)
        const named = path.join(path.dirname(file), `${session.time.created}-cache-plan.md`)
        await Bun.write(named, "Do implementation step 1")

        const tool = await init()
        const result = await rt.runPromise(
          tool.execute(
            {},
            {
              sessionID: session.id,
              messageID: MessageID.make("msg_plan_exit_nongit"),
              agent: "plan",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          ),
        )

        expect(result.metadata.plan).toBe(named)
      },
    })
  })

  test("plan_exit recovers plan written by a custom architect-slug agent", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const file = path.join(Instance.worktree, ".plans", "refactor.md")
        await Bun.write(file, "Do implementation step 1")

        const session = await rt.runPromise(
          Session.Service.use((svc) =>
            Effect.gen(function* () {
              const info = yield* svc.create({ title: "custom-slug" })
              const msg = yield* svc.updateMessage({
                id: MessageID.ascending(),
                role: "user",
                sessionID: info.id,
                time: { created: Date.now() },
                agent: "sr-architect",
                model: { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-sonnet-5") },
              })
              yield* svc.updatePart({
                id: PartID.ascending(),
                messageID: msg.id,
                sessionID: info.id,
                type: "tool",
                callID: "call_write_custom",
                tool: "write",
                state: {
                  status: "completed",
                  input: { filePath: file, content: "Do implementation step 1" },
                  output: "",
                  title: "write",
                  metadata: {},
                  time: { start: Date.now(), end: Date.now() },
                },
              })
              return info
            }),
          ),
        )

        const tool = await init()
        const result = await rt.runPromise(
          tool.execute(
            {},
            {
              sessionID: session.id,
              messageID: MessageID.make("msg_plan_exit_custom_agent"),
              agent: "sr-architect",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          ),
        )

        expect(result.metadata.plan.replaceAll(path.sep, "/")).toBe(".plans/refactor.md")
      },
    })
  })

  test("plan_exit ignores .md files written by non-plan agents", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const file = path.join(Instance.worktree, "docs", "notes.md")
        await Bun.write(file, "Not a plan")

        const session = await rt.runPromise(
          Session.Service.use((svc) =>
            Effect.gen(function* () {
              const info = yield* svc.create({ title: "code-md" })
              const msg = yield* svc.updateMessage({
                id: MessageID.ascending(),
                role: "user",
                sessionID: info.id,
                time: { created: Date.now() },
                agent: "code",
                model: { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-sonnet-5") },
              })
              yield* svc.updatePart({
                id: PartID.ascending(),
                messageID: msg.id,
                sessionID: info.id,
                type: "tool",
                callID: "call_write_docs",
                tool: "write",
                state: {
                  status: "completed",
                  input: { filePath: file, content: "Not a plan" },
                  output: "",
                  title: "write",
                  metadata: {},
                  time: { start: Date.now(), end: Date.now() },
                },
              })
              return info
            }),
          ),
        )

        const tool = await init()
        await expect(
          rt.runPromise(
            tool.execute(
              {},
              {
                sessionID: session.id,
                messageID: MessageID.make("msg_plan_exit_code_md"),
                agent: "plan",
                abort: AbortSignal.any([]),
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            ),
          ),
        ).rejects.toThrow("Plan file not found")
      },
    })
  })

  test("plan_exit names the rejected path in its error instead of guessing an unrelated filename", async () => {
    await using tmp = await tmpdir({ git: true })
    await using outside = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await rt.runPromise(Session.Service.use((svc) => svc.create({ title: "outside-path" })))
        const file = path.join(outside.path, "plan.md")
        await Bun.write(file, "Do implementation step 1")

        const tool = await init()
        await expect(
          rt.runPromise(
            tool.execute(
              { path: file },
              {
                sessionID: session.id,
                messageID: MessageID.make("msg_plan_exit_outside"),
                agent: "plan",
                abort: AbortSignal.any([]),
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            ),
          ),
        ).rejects.toThrow(`The path "${file}" you passed can't be used directly`)
      },
    })
  })

  test("plan_exit recovers when a rejected path is actually the canonical non-git dir", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        const session = await rt.runPromise(Session.Service.use((svc) => svc.create({ title: "global-dir-path" })))
        const canonical = Session.plan(session, ctx)
        const named = path.join(path.dirname(canonical), `${session.time.created}-my-plan.md`)
        await Bun.write(named, "Do implementation step 1")

        const tool = await init()
        const result = await rt.runPromise(
          tool.execute(
            { path: named },
            {
              sessionID: session.id,
              messageID: MessageID.make("msg_plan_exit_global_path"),
              agent: "plan",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          ),
        )

        expect(result.metadata.plan).toBe(named)
      },
    })
  })

  test("plan_exit fails when the plan file was not written", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await rt.runPromise(Session.Service.use((svc) => svc.create({ title: "missing-plan" })))
        const tool = await init()

        await expect(
          rt.runPromise(
            tool.execute(
              {},
              {
                sessionID: session.id,
                messageID: MessageID.make("msg_plan_exit_missing"),
                agent: "plan",
                abort: AbortSignal.any([]),
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            ),
          ),
        ).rejects.toThrow("Plan file not found")
      },
    })
  })

  test("rejects custom plan paths outside the worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
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
