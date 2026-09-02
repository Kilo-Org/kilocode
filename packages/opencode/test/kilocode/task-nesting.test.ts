import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { afterEach, describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { SessionDrain } from "@/kilocode/session/drain"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Session } from "../../src/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { BackgroundProcess } from "../../src/kilocode/background-process"
import { Shell } from "@opencode-ai/core/shell"
import path from "path"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Provider } from "../../src/provider/provider"
import { Permission } from "../../src/permission"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import type { Context } from "../../src/tool/tool"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import * as SandboxPolicy from "../../src/kilocode/sandbox/policy"
import { Truncate } from "../../src/tool/truncate"
import { ToolRegistry } from "../../src/tool/registry"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Agent.node,
      BackgroundJob.node,
      Bus.node,
      Config.node,
      RuntimeFlags.node,
      SessionRunState.node,
      SessionStatus.node,
      SessionDrain.node,
      EventV2Bridge.node,
      CrossSpawnSpawner.node,
      Session.node,
      SessionProjector.node,
      Truncate.node,
      Provider.node,
      ToolRegistry.node,
      Database.node,
    ]),
  ),
)

afterEach(async () => {
  await disposeAllInstances()
})

const seed = Effect.fn("NestedTaskToolTest.seed")(function* () {
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({ title: "Parent" })
  const user = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* sessions.updateMessage(assistant)
  return { chat, assistant }
})

function quote(input: string) {
  const value = input.replaceAll("\\", "/")
  if (process.platform === "win32") return `"${value.replaceAll('"', '""')}"`
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function script(dir: string) {
  const file = path.join(dir, "inherited-task.mjs")
  await Bun.write(file, "setInterval(() => {}, 1_000)\n")
  const command = `${quote(process.execPath)} ${quote(file)}`
  if (Shell.ps(Shell.acceptable())) return `& ${command}`
  return command
}

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  const prompt = (input: SessionPrompt.PromptInput) =>
    Effect.sync(() => {
      opts?.onPrompt?.(input)
      const id = MessageID.ascending()
      return {
        info: {
          id,
          role: "assistant",
          parentID: input.messageID ?? MessageID.ascending(),
          sessionID: input.sessionID,
          mode: input.agent ?? "general",
          agent: input.agent ?? "general",
          cost: 0,
          path: { cwd: "/tmp", root: "/tmp" },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ref.modelID,
          providerID: ref.providerID,
          time: { created: Date.now() },
          finish: "stop",
        },
        parts: [
          {
            id: PartID.ascending(),
            messageID: id,
            sessionID: input.sessionID,
            type: "text",
            text: opts?.text ?? "done",
          },
        ],
      } satisfies MessageV2.WithParts
    })
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt,
  }
}

describe("Kilo task nesting", () => {
  it.live("treats a missing ancestor row as the root", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { assistant } = yield* seed()
        const child = yield* sessions.create({ parentID: SessionID.make("ses_missing_ancestor"), title: "Child" })
        const nested = yield* sessions.updateMessage({
          ...assistant,
          id: MessageID.ascending(),
          parentID: MessageID.ascending(),
          sessionID: child.id,
        })
        const tool = yield* TaskTool
        const def = yield* tool.init()

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "explore",
          },
          {
            sessionID: child.id,
            messageID: nested.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect((yield* sessions.get(result.metadata.sessionId)).parentID).toBe(child.id)
      }),
    ),
  )

  it.live("allows primary agents to delegate one level to a subagent", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "explore",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const kids = yield* sessions.children(chat.id)
        expect(kids).toHaveLength(1)
        expect(kids[0]?.id).toBe(result.metadata.sessionId)
        expect(kids[0]?.parentID).toBe(chat.id)
        expect(seen?.sessionID).toBe(result.metadata.sessionId)
        expect(seen?.agent).toBe("explore")
      }),
    ),
  )

  it.live("transfers inherited background processes when the child run completes", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        const command = yield* Effect.promise(() => script(dir))
        const base = stubOps()
        const promptOps: TaskPromptOps = {
          ...base,
          prompt: (input) =>
            Effect.gen(function* () {
              yield* Effect.promise(() =>
                BackgroundProcess.start({
                  sessionID: input.sessionID,
                  parentID: chat.id,
                  command,
                  cwd: dir,
                  lifetime: "parent",
                }),
              )
              return yield* base.prompt(input)
            }),
        }

        const result = yield* def.execute(
          {
            description: "start inherited process",
            prompt: "start a process",
            subagent_type: "explore",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const childID = SessionID.make(result.metadata.sessionId)
        expect(yield* Effect.promise(() => BackgroundProcess.list({ sessionID: childID }))).toEqual([])
        const inherited = yield* Effect.promise(() => BackgroundProcess.list({ sessionID: chat.id }))
        expect(inherited).toHaveLength(1)
        expect(inherited[0]?.lifetime).toBe("session")
        yield* Effect.promise(() => BackgroundProcess.stopSession(chat.id))
      }),
    ),
  )

  it.live("disables nested and human-driven tools even when global permissions allow them", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const { chat, assistant } = yield* seed()
          const tool = yield* TaskTool
          const def = yield* tool.init()
          let seen: SessionPrompt.PromptInput | undefined
          const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

          const result = yield* def.execute(
            {
              description: "inspect bug",
              prompt: "look into the cache key path",
              subagent_type: "explore",
            },
            {
              sessionID: chat.id,
              messageID: assistant.id,
              agent: "build",
              abort: new AbortController().signal,
              extra: { promptOps },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )

          const child = yield* sessions.get(result.metadata.sessionId)
          expect(seen?.tools?.task).toBe(false)
          expect(seen?.tools?.question).toBe(false)
          expect(seen?.tools?.interactive_terminal).toBe(false)
          expect(child.permission).toEqual(
            expect.arrayContaining([
              {
                permission: "task",
                pattern: "*",
                action: "deny",
              },
              {
                permission: "question",
                pattern: "*",
                action: "deny",
              },
              {
                permission: "suggest",
                pattern: "*",
                action: "deny",
              },
              {
                permission: "interactive_terminal",
                pattern: "*",
                action: "deny",
              },
            ]),
          )
        }),
      {
        config: {
          permission: {
            task: "allow",
            question: "allow",
            interactive_terminal: "allow",
          },
        },
      },
    ),
  )

  test("preserves inherited restrictions while refreshing prompt tool toggles", () => {
    const permission = KiloSessionPrompt.mergeToolPermissions({
      existing: [
        { permission: "bash", pattern: "*", action: "deny" },
        { permission: "edit", pattern: "*", action: "deny" },
      ],
      toggles: [
        { permission: "task", pattern: "*", action: "deny" },
        { permission: "edit", pattern: "*", action: "allow" },
      ],
    })

    expect(permission).toEqual([
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "task", pattern: "*", action: "deny" },
      { permission: "edit", pattern: "*", action: "allow" },
    ])
  })

  it.live("preserves a custom subagent bash policy while inheriting parent denials", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const agents = yield* Agent.Service
          const { chat, assistant } = yield* seed()
          const tool = yield* TaskTool
          const def = yield* tool.init()

          const result = yield* def.execute(
            {
              description: "validate ansible",
              prompt: "run ansible-lint --version",
              subagent_type: "validator",
            },
            {
              sessionID: chat.id,
              messageID: assistant.id,
              agent: "build",
              abort: new AbortController().signal,
              extra: { promptOps: stubOps() },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )

          const child = yield* sessions.get(result.metadata.sessionId)
          const validator = yield* agents.get("validator")
          expect(validator).toBeDefined()
          if (!validator) return

          expect(Permission.evaluate("bash", "ansible-lint --version", validator.permission).action).toBe("allow")
          expect(Permission.evaluate("bash", "rm -rf build", validator.permission).action).toBe("deny")

          const effective = Permission.merge(
            validator.permission,
            KiloSessionPrompt.guardPermissions({ agent: validator, session: child }),
          )
          expect(child.permission).not.toContainEqual({ permission: "bash", pattern: "*", action: "ask" })
          // The calling agent's own bash policy is no longer projected onto the subagent as a
          // ceiling (#11523); the subagent's own `*: deny` policy is what keeps `rm -rf` denied.
          expect(child.permission).not.toContainEqual({ permission: "bash", pattern: "rm -rf *", action: "deny" })
          expect({
            allowed: Permission.evaluate("bash", "ansible-lint --version", effective).action,
            denied: Permission.evaluate("bash", "rm -rf build", effective).action,
          }).toEqual({ allowed: "allow", denied: "deny" })
        }),
      {
        config: {
          permission: {
            bash: {
              "*": "ask",
              "git -c *": "allow",
              "echo *": "allow",
              "rm -rf *": "deny",
            },
          },
          agent: {
            validator: {
              mode: "subagent",
              permission: {
                bash: {
                  "*": "deny",
                  "*ansible-lint*": "allow",
                },
              },
            },
          },
        },
      },
    ),
  )

  it.live("refreshes inherited restrictions when resuming a task child", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const { chat, assistant } = yield* seed()
          const support = yield* SandboxPolicy.status(chat.id)
          yield* sessions.setPermission({
            sessionID: chat.id,
            permission: [{ permission: "bash", pattern: "*", action: "deny" }],
          })
          const child = yield* sessions.create({ parentID: chat.id, title: "Existing child" })
          if (support.available) {
            yield* SandboxPolicy.toggle(child.id)
            expect((yield* SandboxPolicy.status(child.id)).enabled).toBe(false)
          }
          const tool = yield* TaskTool
          const def = yield* tool.init()

          const exec = () =>
            def.execute(
              {
                description: "inspect bug",
                prompt: "look into the cache key path",
                subagent_type: "explore",
                task_id: child.id,
              },
              {
                sessionID: chat.id,
                messageID: assistant.id,
                agent: "build",
                abort: new AbortController().signal,
                extra: { promptOps: stubOps() },
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )

          yield* exec()
          const first = yield* sessions.get(child.id)
          if (support.available) expect((yield* SandboxPolicy.status(child.id)).enabled).toBe(true)
          const count = first.permission?.filter((rule) => rule.permission === "bash").length
          yield* exec()

          const resumed = yield* sessions.get(child.id)
          expect(resumed.permission).toEqual(
            expect.arrayContaining([{ permission: "bash", pattern: "*", action: "deny" }]),
          )
          expect(count).toBeGreaterThan(0)
          expect(resumed.permission?.filter((rule) => rule.permission === "bash")).toHaveLength(count ?? 0)
        }),
      { config: { sandbox: { enabled: true } } },
    ),
  )

  it.live("rejects task_id from a different parent session", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const foreign = yield* sessions.create({ title: "Foreign parent" })
        const child = yield* sessions.create({ parentID: foreign.id, title: "Foreign child" })
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()

        const exit = yield* def
          .execute(
            {
              description: "inspect bug",
              prompt: "look into the cache key path",
              subagent_type: "explore",
              task_id: child.id,
            },
            {
              sessionID: chat.id,
              messageID: assistant.id,
              agent: "build",
              abort: new AbortController().signal,
              extra: { promptOps: stubOps() },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )
          .pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
        expect(yield* sessions.children(chat.id)).toHaveLength(0)
      }),
    ),
  )
})

describe("Kilo task drain", () => {
  function task(message: MessageV2.Assistant, ops: TaskPromptOps, metadata: Context["metadata"] = () => Effect.void) {
    return Effect.gen(function* () {
      const tool = yield* (yield* TaskTool).init()
      return yield* tool.execute(
        {
          description: "Drain child",
          prompt: "Return the completed result",
          subagent_type: "general",
          background: false,
        },
        {
          sessionID: message.sessionID,
          messageID: message.id,
          agent: message.agent,
          abort: new AbortController().signal,
          extra: { promptOps: ops },
          messages: [],
          metadata,
          ask: () => Effect.void,
        },
      )
    })
  }

  it.instance("returns the child's final answer after nested background delivery drains", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const drain = yield* SessionDrain.Service
      const { assistant } = yield* seed()
      const entered = yield* Deferred.make<{ input: SessionPrompt.PromptInput; release: () => void }>()
      const ops: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) =>
          Effect.gen(function* () {
            const grandchild = yield* sessions.create({ parentID: input.sessionID, title: "nested background" })
            yield* drain.link(grandchild.id, input.sessionID)
            const release = yield* drain.hold(grandchild.id)
            const initial = yield* stubOps({ text: "WAITING_FOR_NESTED_CHILD" }).prompt(input)
            yield* sessions.updateMessage(initial.info)
            for (const part of initial.parts) yield* sessions.updatePart(part)
            yield* Deferred.succeed(entered, { input, release })
            return initial
          }),
      }
      const running = yield* task(assistant, ops).pipe(Effect.forkChild)
      const pending = yield* Deferred.await(entered)
      const final = yield* stubOps({ text: "FINAL_NESTED_RESULT" }).prompt(pending.input)
      yield* sessions.updateMessage(final.info)
      for (const part of final.parts) yield* sessions.updatePart(part)
      pending.release()
      const result = yield* Fiber.join(running)
      expect(result.output).toContain("FINAL_NESTED_RESULT")
      expect(result.output).not.toContain("WAITING_FOR_NESTED_CHILD")
    }),
  )

  it.instance("promotion installs delivery cleanup even when its metadata hook fails", () =>
    Effect.gen(function* () {
      const background = yield* BackgroundJob.Service
      const drain = yield* SessionDrain.Service
      const { chat, assistant } = yield* seed()
      const child = yield* Deferred.make<SessionID>()
      const releaseChild = yield* Deferred.make<void>()
      const metadata = yield* Deferred.make<void>()
      const releaseMetadata = yield* Deferred.make<void>()
      const notification = yield* Deferred.make<void>()
      const releaseNotification = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const gate of [releaseChild, releaseMetadata, releaseNotification])
            Deferred.doneUnsafe(gate, Effect.void)
        }),
      )
      let notifications = 0
      const ops: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) =>
          Effect.gen(function* () {
            if (input.sessionID === chat.id) {
              notifications++
              yield* Deferred.succeed(notification, undefined)
              yield* Deferred.await(releaseNotification)
            } else {
              yield* Deferred.succeed(child, input.sessionID)
              yield* Deferred.await(releaseChild)
            }
            return yield* stubOps({ text: "completed" }).prompt(input)
          }),
      }
      const running = yield* task(assistant, ops, (input) =>
        input.metadata?.background === true
          ? Effect.gen(function* () {
              yield* Deferred.succeed(metadata, undefined)
              yield* Deferred.await(releaseMetadata)
              return yield* Effect.die(new Error("metadata hook failed"))
            })
          : Effect.void,
      ).pipe(Effect.forkChild)
      const childID = yield* Deferred.await(child)
      const promotion = yield* background.promote(childID).pipe(Effect.exit, Effect.forkChild)
      yield* Deferred.await(metadata)
      const result = yield* Fiber.join(running)
      expect(result.metadata.background).toBe(true)
      const waiting = yield* drain.wait(chat.id).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.succeed(releaseChild, undefined)
      yield* Deferred.await(notification)
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(releaseNotification, undefined)
      yield* Fiber.join(waiting)
      yield* Deferred.succeed(releaseMetadata, undefined)
      expect(Exit.isFailure(yield* Fiber.join(promotion))).toBe(true)
      expect(notifications).toBe(1)
      yield* drain.wait(chat.id)
    }),
  )
})
