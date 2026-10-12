import { describe, expect, spyOn, test } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Agent } from "@/agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionCompaction } from "@/session/compaction"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { KiloSessionPrompt } from "@/kilocode/session/prompt"
import { KiloSessionMessageOrder } from "@/kilocode/session/message-order"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { TestInstance, seedProject } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Database.node,
      SessionPrompt.node,
      SessionCompaction.node,
      Session.node,
      SessionProjector.node,
      Agent.node,
      EventV2Bridge.node,
      FSUtil.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
    ]),
  ),
)

const setup = Effect.gen(function* () {
  yield* seedProject
  const llm = yield* TestLLMServer
  const fs = yield* FSUtil.Service
  const instance = yield* TestInstance
  yield* fs.writeWithDirs(
    `${instance.directory}/opencode.json`,
    JSON.stringify({
      model: "test/shell-model",
      small_model: "test/shell-model",
      enabled_providers: ["test"],
      snapshot: false,
      lsp: false,
      compaction: { auto: false, prune: false, tail_turns: 0 },
      agent: { title: { disable: true } },
      provider: {
        test: {
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "test-key", baseURL: llm.url },
          models: {
            "shell-model": { name: "Shell Model", tool_call: true, limit: { context: 100000, output: 10000 } },
          },
        },
      },
    }),
  )
  const sessions = yield* Session.Service
  const prompt = yield* SessionPrompt.Service
  const session = yield* sessions.create({ title: "Shell prefix regression" })
  const send = (editor?: { shell?: string; activeFile?: string }, synthetic = false, system?: string) =>
    Effect.gen(function* () {
      yield* llm.push(reply().text("Recorded").stop())
      return yield* prompt.prompt({
        sessionID: session.id,
        agent: "code",
        editorContext: editor,
        system,
        parts: [{ type: "text", text: synthetic ? "Background task completed" : "Record this turn", synthetic }],
      })
    })
  const systems = llm.hits.pipe(
    Effect.map((hits) =>
      hits.map((hit) => {
        if (!Array.isArray(hit.body.messages)) throw new Error("Expected provider messages")
        return JSON.stringify(hit.body.messages.filter((msg) => msg.role === "system"))
      }),
    ),
  )
  return { llm, sessions, prompt, session, send, systems }
})

it.instance(
  "keeps complete system prompts byte-identical across typed, synthetic, and typed messages",
  Effect.gen(function* () {
    const run = yield* setup
    yield* run.send({ shell: "/bin/fish", activeFile: "first.ts" })
    yield* run.send(undefined, true)
    yield* run.send({ shell: "/bin/fish", activeFile: "second.ts" })
    const systems = yield* run.systems
    expect(systems).toHaveLength(3)
    expect(systems.at(0)).toContain("Default shell: /bin/fish")
    expect(systems.at(1)).toBe(systems.at(0))
    expect(systems.at(2)).toBe(systems.at(0))
    const stored = yield* run.sessions.messages({ sessionID: run.session.id })
    const users = stored.filter((msg) => msg.info.role === "user")
    const internal = users.at(1)?.info
    expect(internal?.role === "user" ? internal.editorContext : undefined).toBeUndefined()
    expect(
      users.flatMap((msg) => msg.parts).some((part) => part.type === "text" && part.text.includes("Default shell")),
    ).toBe(false)
  }),
  240_000,
)

it.instance(
  "changes the shell once for a new editor snapshot and retains it on later synthetic turns",
  Effect.gen(function* () {
    const run = yield* setup
    yield* run.send({ shell: "/bin/fish" })
    yield* run.send(undefined, true)
    yield* run.send({ shell: "/bin/zsh" })
    yield* run.send(undefined, true)
    const systems = yield* run.systems
    expect(systems.at(1)).toBe(systems.at(0))
    expect(systems.at(2)).toBe(systems.at(0)?.replace("Default shell: /bin/fish", "Default shell: /bin/zsh"))
    expect(systems.at(3)).toBe(systems.at(2))
  }),
  240_000,
)

it.instance(
  "keeps today's no-shell output and does no extra history lookup for no-context clients",
  Effect.gen(function* () {
    const run = yield* setup
    const lookup = spyOn(run.sessions, "findMessage")
    const { db } = yield* Database.Service
    const select = spyOn(db, "select")
    yield* Effect.addFinalizer(() => Effect.sync(() => lookup.mockRestore()))
    yield* Effect.addFinalizer(() => Effect.sync(() => select.mockRestore()))
    yield* run.send()
    yield* run.send(undefined, true)
    const systems = yield* run.systems
    expect(systems).toHaveLength(2)
    expect(systems.at(0)).not.toContain("Default shell:")
    expect(systems.at(1)).toBe(systems.at(0))
    const real = user("msg_real")
    const internal = user("msg_internal", {}, true)
    const contextLookups = lookup.mock.calls.filter(([, predicate]) => predicate(real) && !predicate(internal))
    expect(contextLookups).toHaveLength(0)
    const snapshots = select.mock.calls.filter(
      ([fields]) => fields && "data" in fields && Object.keys(fields).length === 1,
    )
    expect(snapshots).toHaveLength(0)
  }),
  240_000,
)

it.instance(
  "treats a supplied empty editor snapshot as a shell update, not missing context",
  Effect.gen(function* () {
    const run = yield* setup
    yield* run.send({ shell: "/bin/fish" })
    yield* run.send({})
    yield* run.send(undefined, true)
    const systems = yield* run.systems
    expect(systems.at(1)).not.toContain("Default shell:")
    expect(systems.at(2)).toBe(systems.at(1))
  }),
  240_000,
)

it.instance(
  "compaction from a synthetic turn carries shell and system into the stored checkpoint",
  Effect.gen(function* () {
    const run = yield* setup
    const system = "Retain this custom system instruction"
    yield* run.send({ shell: "/bin/fish" }, false, system)
    yield* run.send(undefined, true)
    const compact = yield* SessionCompaction.Service
    yield* compact.create({
      sessionID: run.session.id,
      agent: "code",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("shell-model") },
      auto: false,
    })
    yield* run.llm.push(reply().text("The synthetic archive is summarized").stop())
    yield* run.prompt.loop({ sessionID: run.session.id })
    const stored = yield* run.sessions.messages({ sessionID: run.session.id })
    const checkpoint = stored.find((msg) => msg.parts.some((part) => part.type === "compaction"))
    expect(checkpoint?.info).toMatchObject({ editorContext: { shell: "/bin/fish" }, system })
    const projected = yield* MessageV2.filterCompactedEffect(run.session.id)
    expect(projected.some((msg) => msg.info.id === stored.at(0)?.info.id)).toBe(false)
    yield* run.send(undefined, true)
    const systems = yield* run.systems
    expect(systems.at(1)).toBe(systems.at(0))
    expect(systems.at(3)).toBe(systems.at(0))
  }),
  240_000,
)

it.instance(
  "preserves custom system text on internal messages and updates it on real input",
  Effect.gen(function* () {
    const run = yield* setup
    yield* run.send({ shell: "/bin/fish" }, false, "Retain the custom instruction")
    yield* run.send({ shell: "/bin/fish" }, true)
    yield* run.send({ shell: "/bin/fish" }, false, "Use the replacement instruction")
    yield* run.send(undefined, true)
    yield* run.send({ shell: "/bin/fish" }, false, "")
    yield* run.send(undefined, true)
    const systems = yield* run.systems
    expect(systems.at(0)).toContain("Retain the custom instruction")
    expect(systems.at(1)).toBe(systems.at(0))
    expect(systems.at(2)).toBe(
      systems.at(0)?.replace("Retain the custom instruction", "Use the replacement instruction"),
    )
    expect(systems.at(3)).toBe(systems.at(2))
    expect(systems.at(4)).not.toContain("Use the replacement instruction")
    expect(systems.at(5)).toBe(systems.at(4))
  }),
  240_000,
)

it.instance(
  "a real no-context input resets inherited context, like the goal runner",
  Effect.gen(function* () {
    const run = yield* setup
    yield* run.send({ shell: "/bin/fish" }, false, "Custom instruction")
    yield* run.send(undefined, true)
    yield* run.send()
    yield* run.send(undefined, true)
    const systems = yield* run.systems
    expect(systems.at(1)).toBe(systems.at(0))
    expect(systems.at(2)).not.toContain("Default shell:")
    expect(systems.at(2)).not.toContain("Custom instruction")
    expect(systems.at(3)).toBe(systems.at(2))
  }),
  240_000,
)

function user(
  id: string,
  context: Partial<Pick<MessageV2.User, "editorContext" | "system">> = {},
  synthetic = false,
): MessageV2.WithParts & { info: MessageV2.User } {
  return {
    info: {
      id: MessageID.make(id),
      sessionID: SessionID.make("ses_context"),
      role: "user",
      time: { created: 1 },
      agent: "code",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("shell-model") },
      ...context,
    },
    parts: [
      {
        id: PartID.make(`prt_${id}`),
        sessionID: SessionID.make("ses_context"),
        messageID: MessageID.make(id),
        type: "text",
        text: "Fixture",
        synthetic,
      },
    ],
  }
}

describe("context selection in the existing chronology pass", () => {
  test("uses stored chronology when retained-tail projection and tied timestamps reorder the list", () => {
    const first = user("msg_z", { editorContext: { shell: "/bin/fish" } })
    const second = user("msg_a", { editorContext: { shell: "/bin/zsh" } })
    const internal = user("msg_internal", {}, true)
    KiloSessionMessageOrder.annotate([first, second, internal])
    const state = KiloSessionMessageOrder.latest([second, internal, first])
    expect(state.context?.editorContext).toEqual({ shell: "/bin/zsh" })
    expect(state.user?.id).toBe(internal.info.id)
  })

  test("a queue-scoped list never sees a later queued editor snapshot", () => {
    const first = user("msg_first", { editorContext: { shell: "/bin/fish" } })
    const internal = user("msg_internal", {}, true)
    const queued = user("msg_queued", { editorContext: { shell: "/bin/zsh" } })
    KiloSessionMessageOrder.annotate([first, internal, queued])
    expect(KiloSessionMessageOrder.latest([first, internal]).context?.editorContext).toEqual({ shell: "/bin/fish" })
    expect(KiloSessionMessageOrder.latest([first, internal, queued]).context?.editorContext).toEqual({
      shell: "/bin/zsh",
    })
  })

  test("the selection pass requires no database service or history query", () => {
    const first = user("msg_first")
    const internal = user("msg_internal", {}, true)
    expect(KiloSessionMessageOrder.latest([first, internal]).context?.editorContext).toBeUndefined()
    const selected = KiloSessionPrompt.inheritContext(internal.info, first.info)
    expect(selected === internal.info).toBe(true)
  })

  test("copied editor context on a synthetic notification does not erase the real system instruction", () => {
    const first = user("msg_first", { editorContext: { shell: "/bin/fish" }, system: "Custom instruction" })
    const internal = user("msg_internal", { editorContext: { shell: "/bin/fish" } }, true)
    KiloSessionMessageOrder.annotate([first, internal])
    const state = KiloSessionMessageOrder.latest([first, internal])
    expect(state.context?.id).toBe(first.info.id)
    expect(KiloSessionPrompt.inheritContext(state.user!, state.context).system).toBe("Custom instruction")
  })

  test("an empty checkpoint prevents older retained-tail context from reviving a cleared shell", () => {
    const first = user("msg_first", { editorContext: { shell: "/bin/fish" }, system: "Old instruction" })
    const checkpoint = user("msg_checkpoint", { system: "" }, true)
    checkpoint.parts = [
      {
        id: PartID.make("prt_compact"),
        messageID: checkpoint.info.id,
        sessionID: checkpoint.info.sessionID,
        type: "compaction",
        auto: false,
      },
    ]
    const internal = user("msg_internal", {}, true)
    KiloSessionMessageOrder.annotate([first, checkpoint, internal])
    const state = KiloSessionMessageOrder.latest([checkpoint, internal, first])
    expect(state.context?.id).toBe(checkpoint.info.id)
    const recovered = KiloSessionPrompt.inheritContext(state.user!, state.context)
    expect(recovered.editorContext).toBeUndefined()
    expect(recovered.system).toBe("")
  })
})
