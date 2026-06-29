import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Session } from "../../src/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { BackgroundProcess } from "../../src/kilocode/background-process"
import { Shell } from "../../src/shell/shell"
import path from "path"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Provider } from "../../src/provider/provider"
import { Permission } from "../../src/permission"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import * as SandboxPolicy from "../../src/kilocode/sandbox/policy"
import { Truncate } from "../../src/tool/truncate"
import { ToolRegistry } from "../../src/tool/registry"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    BackgroundJob.defaultLayer,
    Bus.defaultLayer,
    Config.defaultLayer,
    RuntimeFlags.layer(),
    SessionRunState.defaultLayer,
    SessionStatus.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    Truncate.defaultLayer,
    Provider.defaultLayer,
    ToolRegistry.defaultLayer,
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

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void }): TaskPromptOps {
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
            text: "done",
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
          expect(child.permission).toContainEqual({ permission: "bash", pattern: "rm -rf *", action: "deny" })
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
    provideTmpdirInstance(() =>
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
