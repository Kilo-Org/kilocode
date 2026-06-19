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
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Provider } from "../../src/provider/provider"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { REVIEWER_AGENT } from "../../src/kilocode/agent"
import { Permission } from "../../src/permission"
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

const seedMessage = Effect.fn("NestedTaskToolTest.seedMessage")(function* (input: {
  session: Session.Info
  agent: string
}) {
  const sessions = yield* Session.Service
  const user = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: input.session.id,
    agent: input.agent,
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: input.session.id,
    mode: input.agent,
    agent: input.agent,
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* sessions.updateMessage(assistant)
  return assistant
})

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
    loop: (input) => prompt({ sessionID: input.sessionID, parts: [] }),
  }
}

describe("Kilo task nesting", () => {
  it.live("allows Reviewer to delegate once to Explore", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        const seen: SessionPrompt.PromptInput[] = []
        const promptOps = stubOps({ onPrompt: (input) => seen.push(input) })

        const review = yield* def.execute(
          {
            description: "review changes",
            prompt: "review uncommitted changes",
            subagent_type: REVIEWER_AGENT,
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

        const reviewer = yield* sessions.get(review.metadata.sessionId)
        expect(reviewer.agent).toBe(REVIEWER_AGENT)
        expect(seen[0]?.sessionID).toBe(reviewer.id)
        expect(seen[0]?.agent).toBe(REVIEWER_AGENT)
        expect(seen[0]?.tools?.task).toBeUndefined()
        expect(seen[0]?.tools?.question).toBe(false)
        expect(reviewer.permission).toEqual(
          expect.arrayContaining([{ permission: "question", pattern: "*", action: "deny" }]),
        )
        expect(
          reviewer.permission?.some(
            (rule) => rule.permission === "task" && rule.pattern === "*" && rule.action === "deny",
          ),
        ).toBe(false)

        yield* def.execute(
          {
            description: "review changes",
            prompt: "continue review",
            subagent_type: REVIEWER_AGENT,
            task_id: reviewer.id,
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
        expect(seen[1]?.sessionID).toBe(reviewer.id)
        expect(seen[1]?.tools?.task).toBeUndefined()
        expect(seen[1]?.tools?.question).toBe(false)

        const msg = yield* seedMessage({ session: reviewer, agent: REVIEWER_AGENT })
        const exploreSeen: SessionPrompt.PromptInput[] = []
        const exploreOps = stubOps({ onPrompt: (input) => exploreSeen.push(input) })
        const result = yield* def.execute(
          {
            description: "security track",
            prompt: "research the security track",
            subagent_type: "explore",
          },
          {
            sessionID: reviewer.id,
            messageID: msg.id,
            agent: "explore",
            abort: new AbortController().signal,
            extra: { promptOps: exploreOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const explore = yield* sessions.get(result.metadata.sessionId)
        expect(explore.parentID).toBe(reviewer.id)
        expect(explore.agent).toBe("explore")
        expect(exploreSeen[0]?.sessionID).toBe(explore.id)
        expect(exploreSeen[0]?.agent).toBe("explore")
        expect(exploreSeen[0]?.tools?.task).toBe(false)
        expect(exploreSeen[0]?.tools?.question).toBe(false)
        expect(explore.permission).toEqual(
          expect.arrayContaining([
            { permission: "task", pattern: "*", action: "deny" },
            { permission: "question", pattern: "*", action: "deny" },
            { permission: "edit", pattern: "*", action: "deny" },
            { permission: "suggest", pattern: "*", action: "deny" },
          ]),
        )
        expect(Permission.evaluate("edit", "src/file.ts", explore.permission ?? []).action).toBe("deny")
        expect(Permission.evaluate("suggest", "*", explore.permission ?? []).action).toBe("deny")
        expect(Permission.evaluate("bash", "git commit -m test", explore.permission ?? []).action).toBe("deny")
        expect(Permission.evaluate("bash", "git merge-base HEAD main", explore.permission ?? []).action).toBe("allow")
      }),
    ),
  )

  it.live("carries reviewer restrictions into Explore", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const { chat, assistant } = yield* seed()
          const tool = yield* TaskTool
          const def = yield* tool.init()
          const promptOps = stubOps()

          const review = yield* def.execute(
            {
              description: "review changes",
              prompt: "review uncommitted changes",
              subagent_type: REVIEWER_AGENT,
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

          const reviewer = yield* sessions.get(review.metadata.sessionId)
          const msg = yield* seedMessage({ session: reviewer, agent: REVIEWER_AGENT })
          const result = yield* def.execute(
            {
              description: "security track",
              prompt: "research the security track",
              subagent_type: "explore",
            },
            {
              sessionID: reviewer.id,
              messageID: msg.id,
              agent: "explore",
              abort: new AbortController().signal,
              extra: { promptOps },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )

          const explore = yield* sessions.get(result.metadata.sessionId)
          const rules = explore.permission ?? []

          expect(Permission.evaluate("read", "README.md", rules).action).toBe("deny")
          expect(Permission.evaluate("grep", "*", rules).action).toBe("ask")
          expect(Permission.evaluate("glob", "*", rules).action).toBe("deny")
          expect(Permission.evaluate("webfetch", "*", rules).action).toBe("deny")
          expect(Permission.evaluate("skill", "*", rules).action).toBe("ask")
          expect(Permission.evaluate("suggest", "*", rules).action).toBe("deny")
          expect(Permission.evaluate("external_directory", "/tmp/private", rules).action).toBe("deny")
          expect(Permission.evaluate("external_directory", "/tmp/review-cache", rules).action).toBe("allow")
          expect(Permission.evaluate("bash", "git commit -m test", rules).action).toBe("deny")
          expect(rules.some((rule) => rule.permission === "*" && rule.action === "deny")).toBe(false)
        }),
      {
        config: {
          permission: {
            bash: "allow",
            read: "deny",
            grep: "ask",
            glob: "deny",
            webfetch: "deny",
            suggest: "allow",
            skill: "ask",
            external_directory: {
              "*": "deny",
              "/tmp/review-cache": "allow",
            },
          },
        },
      },
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

  it.live("disables nested task and question tools even when global permissions allow them", () =>
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
            ]),
          )
        }),
      {
        config: {
          permission: {
            task: "allow",
            question: "allow",
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

  it.live("refreshes inherited restrictions when resuming a task child", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        yield* sessions.setPermission({
          sessionID: chat.id,
          permission: [{ permission: "bash", pattern: "*", action: "deny" }],
        })
        const child = yield* sessions.create({ parentID: chat.id, title: "Existing child" })
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
