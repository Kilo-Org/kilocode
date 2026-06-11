import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Exit, Layer } from "effect"
import { ModelID, ProviderID } from "@/provider/schema"
import { CheckpointDiff } from "@/kilocode/session/checkpoint-diff"
import { Instance } from "@/project/instance"
import { MessageV2 } from "@/session/message-v2"
import { SessionRevert } from "@/session/revert"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { Snapshot } from "@/snapshot"
import { provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

void Log.init({ print: false })

const env = Layer.mergeAll(
  Session.defaultLayer,
  SessionRevert.defaultLayer,
  Snapshot.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
)
const it = testEffect(env)
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

const exists = (file: string) =>
  Effect.promise(() =>
    fs
      .access(file)
      .then(() => true)
      .catch(() => false),
  )
const read = (file: string) => Effect.promise(() => fs.readFile(file, "utf8"))
const bytes = (file: string) => Effect.promise(() => fs.readFile(file))
const write = (file: string, value: string | Uint8Array) => Effect.promise(() => fs.writeFile(file, value))

const user = Effect.fn("checkpoint.user")(function* (sessionID: SessionID) {
  const session = yield* Session.Service
  return yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user" as const,
    sessionID,
    agent: "default",
    model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") },
    time: { created: Date.now() },
  })
})

const assistant = Effect.fn("checkpoint.assistant")(function* (sessionID: SessionID, parentID: MessageID, dir: string) {
  const session = yield* Session.Service
  return yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "assistant" as const,
    sessionID,
    mode: "default",
    agent: "default",
    path: { cwd: dir, root: dir },
    cost: 0,
    tokens,
    modelID: ModelID.make("gpt-4"),
    providerID: ProviderID.make("openai"),
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  })
})

const text = Effect.fn("checkpoint.text")(function* (sessionID: SessionID, messageID: MessageID, value: string) {
  const session = yield* Session.Service
  return yield* session.updatePart({
    id: PartID.ascending(),
    messageID,
    sessionID,
    type: "text" as const,
    text: value,
  })
})

const step = Effect.fn("checkpoint.step")(function* (input: {
  sessionID: SessionID
  messageID: MessageID
  tools: string[]
  mutate: Effect.Effect<void>
}) {
  const session = yield* Session.Service
  const snapshot = yield* Snapshot.Service
  const before = yield* snapshot.track()
  if (!before) throw new Error("expected step start snapshot")
  const start = yield* session.updatePart({
    id: PartID.ascending(),
    messageID: input.messageID,
    sessionID: input.sessionID,
    type: "step-start" as const,
    snapshot: before,
  })
  for (const [index, name] of input.tools.entries()) {
    yield* session.updatePart({
      id: PartID.ascending(),
      messageID: input.messageID,
      sessionID: input.sessionID,
      type: "tool" as const,
      tool: name,
      callID: `${name}-${index}-${start.id}`,
      state: {
        status: "completed" as const,
        input: {},
        output: "done",
        title: name,
        metadata: {},
        time: { start: index, end: index + 1 },
      },
    })
  }
  yield* input.mutate
  const after = yield* snapshot.track()
  if (!after) throw new Error("expected step finish snapshot")
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: input.messageID,
    sessionID: input.sessionID,
    type: "step-finish" as const,
    reason: "stop",
    snapshot: after,
    cost: 1,
    tokens: { ...tokens, input: 1, total: 1 },
  })
  const patch = yield* snapshot.patch(before)
  if (patch.files.length > 0) {
    yield* session.updatePart({
      id: PartID.ascending(),
      messageID: input.messageID,
      sessionID: input.sessionID,
      type: "patch" as const,
      hash: patch.hash,
      files: patch.files,
    })
  }
  return start
})

const setup = Effect.fn("checkpoint.setup")(function* (dir: string) {
  const session = yield* Session.Service
  const info = yield* session.create({})
  const prompt = yield* user(info.id)
  yield* text(info.id, prompt.id, "make changes")
  const reply = yield* assistant(info.id, prompt.id, dir)
  return { session, sessionID: info.id, prompt, reply }
})

describe("agent step checkpoint restore", () => {
  it.live(
    "restores modified, created, deleted, nested, and binary files at the first checkpoint and unreverts them",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const revert = yield* SessionRevert.Service
          const mod = path.join(dir, "modified.txt")
          const del = path.join(dir, "deleted.txt")
          const add = path.join(dir, "created.txt")
          const deep = path.join(dir, "nested", "created.txt")
          const bin = path.join(dir, "created.bin")
          const old = path.join(dir, "old name.txt")
          const renamed = path.join(dir, "new name.txt")
          const unicode = path.join(dir, "café-文件.txt")
          const untouched = path.join(dir, "untouched.txt")
          yield* write(mod, "before")
          yield* write(del, "restore me")
          yield* write(old, "rename me")
          yield* write(unicode, "unicode before")
          yield* write(untouched, "untouched")
          const state = yield* setup(dir)

          yield* step({
            sessionID: state.sessionID,
            messageID: state.reply.id,
            tools: ["edit", "write", "bash"],
            mutate: Effect.gen(function* () {
              yield* write(mod, "after")
              yield* Effect.promise(() => fs.rm(del))
              yield* write(add, "new")
              yield* Effect.promise(() => fs.mkdir(path.dirname(deep), { recursive: true }))
              yield* write(deep, "nested")
              yield* write(bin, new Uint8Array([0, 1, 2, 255]))
              yield* Effect.promise(() => fs.rename(old, renamed))
              yield* write(unicode, "unicode after")
            }),
          })
          const recorded = (yield* state.session.messages({ sessionID: state.sessionID }))
            .flatMap((message) => message.parts)
            .find((part) => part.type === "patch")
          expect(recorded?.type === "patch" ? recorded.files : []).toContain(old)
          expect(recorded?.type === "patch" ? recorded.files : []).toContain(renamed)

          yield* revert.revert({ sessionID: state.sessionID, messageID: state.prompt.id })
          expect(yield* read(mod)).toBe("before")
          expect(yield* read(del)).toBe("restore me")
          expect(yield* exists(add)).toBe(false)
          expect(yield* exists(deep)).toBe(false)
          expect(yield* exists(bin)).toBe(false)
          expect(yield* read(old)).toBe("rename me")
          expect(yield* exists(renamed)).toBe(false)
          expect(yield* read(unicode)).toBe("unicode before")
          expect(yield* read(untouched)).toBe("untouched")

          yield* revert.unrevert({ sessionID: state.sessionID })
          expect(yield* read(mod)).toBe("after")
          expect(yield* exists(del)).toBe(false)
          expect(yield* read(add)).toBe("new")
          expect(yield* read(deep)).toBe("nested")
          expect(Array.from(yield* bytes(bin))).toEqual([0, 1, 2, 255])
          expect(yield* exists(old)).toBe(false)
          expect(yield* read(renamed)).toBe("rename me")
          expect(yield* read(unicode)).toBe("unicode after")
          expect(yield* read(untouched)).toBe("untouched")
        }),
      { git: true },
    ),
  )

  it.live(
    "restores every later checkpoint in one assistant turn independently",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const revert = yield* SessionRevert.Service
          const snapshot = yield* Snapshot.Service
          const a = path.join(dir, "a.txt")
          const b = path.join(dir, "b.txt")
          const c = path.join(dir, "c.txt")
          yield* write(a, "a0")
          yield* write(b, "b0")
          yield* write(c, "c0")
          const state = yield* setup(dir)
          const first = yield* step({
            sessionID: state.sessionID,
            messageID: state.reply.id,
            tools: ["edit"],
            mutate: write(a, "a1"),
          })
          const second = yield* step({
            sessionID: state.sessionID,
            messageID: state.reply.id,
            tools: ["edit"],
            mutate: write(b, "b1"),
          })
          const third = yield* step({
            sessionID: state.sessionID,
            messageID: state.reply.id,
            tools: ["edit"],
            mutate: write(c, "c1"),
          })
          const messages = yield* state.session.messages({ sessionID: state.sessionID })
          const range = CheckpointDiff.snapshots(messages, state.reply.id, second.id)
          expect(range).toBeDefined()
          if (!range) throw new Error("expected checkpoint diff range")
          expect((yield* snapshot.diffFull(range.from, range.to)).map((diff) => diff.file)).toEqual(["b.txt"])
          expect(CheckpointDiff.snapshots(messages, state.reply.id, PartID.make("prt_missing"))).toBeUndefined()

          yield* revert.revert({ sessionID: state.sessionID, messageID: state.reply.id, partID: third.id })
          expect([yield* read(a), yield* read(b), yield* read(c)]).toEqual(["a1", "b1", "c0"])

          yield* revert.revert({ sessionID: state.sessionID, messageID: state.reply.id, partID: second.id })
          expect([yield* read(a), yield* read(b), yield* read(c)]).toEqual(["a1", "b0", "c0"])

          yield* revert.revert({ sessionID: state.sessionID, messageID: state.reply.id, partID: first.id })
          expect((yield* state.session.get(state.sessionID)).revert?.partID).toBeUndefined()
          expect([yield* read(a), yield* read(b), yield* read(c)]).toEqual(["a0", "b0", "c0"])

          yield* revert.unrevert({ sessionID: state.sessionID })
          expect([yield* read(a), yield* read(b), yield* read(c)]).toEqual(["a1", "b1", "c1"])
        }),
      { git: true },
    ),
  )

  it.live(
    "restores a parallel tool group as one checkpoint",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const revert = yield* SessionRevert.Service
          const left = path.join(dir, "left.txt")
          const right = path.join(dir, "right.txt")
          yield* write(left, "left0")
          yield* write(right, "right0")
          const state = yield* setup(dir)
          yield* step({
            sessionID: state.sessionID,
            messageID: state.reply.id,
            tools: ["edit", "write"],
            mutate: Effect.gen(function* () {
              yield* write(left, "left1")
              yield* write(right, "right1")
            }),
          })

          yield* revert.revert({ sessionID: state.sessionID, messageID: state.prompt.id })
          expect([yield* read(left), yield* read(right)]).toEqual(["left0", "right0"])
        }),
      { git: true },
    ),
  )

  it.live(
    "keeps checkpoint trees reachable across aggressive git garbage collection",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const revert = yield* SessionRevert.Service
          const file = path.join(dir, "durable.txt")
          yield* write(file, "before")
          const state = yield* setup(dir)
          yield* step({
            sessionID: state.sessionID,
            messageID: state.reply.id,
            tools: ["edit"],
            mutate: write(file, "after"),
          })
          const git = path.join(Global.Path.data, "snapshot", Instance.project.id, Hash.fast(Instance.worktree))
          yield* Effect.promise(() => $`git --git-dir=${git} reflog expire --expire=now --all`.quiet())
          yield* Effect.promise(() => $`git --git-dir=${git} gc --prune=now`.quiet())

          yield* revert.revert({ sessionID: state.sessionID, messageID: state.prompt.id })
          expect(yield* read(file)).toBe("before")
        }),
      { git: true },
    ),
  )

  it.live(
    "fails without deleting files when a checkpoint object is unavailable",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const revert = yield* SessionRevert.Service
          const snapshot = yield* Snapshot.Service
          const file = path.join(dir, "protected.txt")
          const valid = path.join(dir, "valid.txt")
          yield* write(file, "keep")
          yield* write(valid, "before")
          const state = yield* setup(dir)
          const before = yield* snapshot.track()
          if (!before) throw new Error("expected valid snapshot")
          yield* write(valid, "after")
          const patch = yield* snapshot.patch(before)
          const missing = "0000000000000000000000000000000000000000"
          const diff = yield* snapshot.diffFull(missing, before).pipe(Effect.exit)
          expect(Exit.isFailure(diff)).toBe(true)
          yield* state.session.updatePart({
            id: PartID.ascending(),
            messageID: state.reply.id,
            sessionID: state.sessionID,
            type: "patch",
            hash: patch.hash,
            files: patch.files,
          })
          yield* state.session.updatePart({
            id: PartID.ascending(),
            messageID: state.reply.id,
            sessionID: state.sessionID,
            type: "patch",
            hash: missing,
            files: [file],
          })

          const exit = yield* revert
            .revert({ sessionID: state.sessionID, messageID: state.prompt.id })
            .pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
          expect(yield* read(file)).toBe("keep")
          expect(yield* read(valid)).toBe("after")
          expect((yield* state.session.get(state.sessionID)).revert).toBeUndefined()
        }),
      { git: true },
    ),
  )

  it.live(
    "refuses file rewind when a compensation snapshot cannot be captured",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const revert = yield* SessionRevert.Service
          const file = path.join(dir, "protected.txt")
          yield* write(file, "keep")
          const state = yield* setup(dir)
          yield* state.session.updatePart({
            id: PartID.ascending(),
            messageID: state.reply.id,
            sessionID: state.sessionID,
            type: "patch",
            hash: "0000000000000000000000000000000000000000",
            files: [file],
          })

          const exit = yield* revert
            .revert({ sessionID: state.sessionID, messageID: state.prompt.id })
            .pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
          expect(yield* read(file)).toBe("keep")
          expect((yield* state.session.get(state.sessionID)).revert).toBeUndefined()
        }),
      { git: true, config: { snapshot: false } },
    ),
  )

  it.live(
    "preserves earlier work when reverting to a Todo tool part in a later assistant message",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const revert = yield* SessionRevert.Service
          const file = path.join(dir, "todo.txt")
          yield* write(file, "initial")
          const state = yield* setup(dir)
          yield* step({
            sessionID: state.sessionID,
            messageID: state.reply.id,
            tools: ["edit"],
            mutate: write(file, "before todo"),
          })
          const todo = yield* assistant(state.sessionID, state.prompt.id, dir)
          yield* step({
            sessionID: state.sessionID,
            messageID: todo.id,
            tools: ["todowrite"],
            mutate: Effect.void,
          })
          const later = yield* assistant(state.sessionID, state.prompt.id, dir)
          yield* step({
            sessionID: state.sessionID,
            messageID: later.id,
            tools: ["edit"],
            mutate: write(file, "after todo"),
          })
          const messages = yield* state.session.messages({ sessionID: state.sessionID })
          const target = messages
            .find((message) => message.info.id === todo.id)
            ?.parts.find((part) => part.type === "tool" && part.tool === "todowrite")
          if (!target) throw new Error("expected Todo tool part")

          const info = yield* revert.revert({
            sessionID: state.sessionID,
            messageID: todo.id,
            partID: target.id,
          })
          expect(info.revert?.messageID).toBe(todo.id)
          expect(info.revert?.partID).toBe(target.id)
          expect(yield* read(file)).toBe("before todo")
        }),
      { git: true },
    ),
  )

  it.live(
    "preserves a Question checkpoint across separate assistant step messages",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const revert = yield* SessionRevert.Service
          const file = path.join(dir, "direction.txt")
          yield* write(file, "initial")
          const state = yield* setup(dir)
          yield* step({
            sessionID: state.sessionID,
            messageID: state.reply.id,
            tools: ["edit"],
            mutate: write(file, "before question"),
          })
          const question = yield* assistant(state.sessionID, state.prompt.id, dir)
          const boundary = yield* step({
            sessionID: state.sessionID,
            messageID: question.id,
            tools: ["question"],
            mutate: Effect.void,
          })
          const after = yield* assistant(state.sessionID, state.prompt.id, dir)
          yield* step({
            sessionID: state.sessionID,
            messageID: after.id,
            tools: ["edit"],
            mutate: write(file, "alpha"),
          })

          const info = yield* revert.revert({
            sessionID: state.sessionID,
            messageID: question.id,
            partID: boundary.id,
          })
          expect(info.revert?.messageID).toBe(question.id)
          expect(info.revert?.partID).toBe(boundary.id)
          expect(yield* read(file)).toBe("before question")

          yield* revert.cleanup(info)
          const messages = yield* state.session.messages({ sessionID: state.sessionID })
          expect(messages.some((message) => message.info.id === state.reply.id)).toBe(true)
          expect(messages.some((message) => message.info.id === after.id)).toBe(false)
        }),
      { git: true },
    ),
  )

  for (const name of ["question", "plan_exit"]) {
    it.live(
      `restores the workspace and conversation before ${name} human input`,
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const revert = yield* SessionRevert.Service
            const file = path.join(dir, "direction.txt")
            yield* write(file, "initial")
            const state = yield* setup(dir)
            yield* step({
              sessionID: state.sessionID,
              messageID: state.reply.id,
              tools: ["edit"],
              mutate: write(file, "before-human-input"),
            })
            const boundary = yield* step({
              sessionID: state.sessionID,
              messageID: state.reply.id,
              tools: [name],
              mutate: Effect.void,
            })
            yield* step({
              sessionID: state.sessionID,
              messageID: state.reply.id,
              tools: ["edit"],
              mutate: write(file, "after-human-input"),
            })
            yield* state.session.updateMessage({
              ...state.reply,
              cost: 3,
              finish: "stop",
              tokens: { ...tokens, input: 3, total: 3 },
            })

            yield* revert.revert({
              sessionID: state.sessionID,
              messageID: state.reply.id,
              partID: boundary.id,
            })
            expect(yield* read(file)).toBe("before-human-input")
            const info = yield* state.session.get(state.sessionID)
            expect(info.revert?.partID).toBe(boundary.id)

            yield* revert.cleanup(info)
            const messages = yield* state.session.messages({ sessionID: state.sessionID })
            const reply = messages.find((message) => message.info.id === state.reply.id)
            expect(reply?.parts.some((part) => part.id === boundary.id)).toBe(false)
            expect(reply?.parts.some((part) => part.type === "tool" && part.tool === name)).toBe(false)
            expect(reply?.parts.some((part) => part.type === "tool" && part.tool === "edit")).toBe(true)
            expect(reply?.info.role === "assistant" ? reply.info.cost : undefined).toBe(1)
            expect(reply?.info.role === "assistant" ? reply.info.tokens.input : undefined).toBe(1)
            expect(reply?.info.role === "assistant" ? reply.info.finish : undefined).toBe("stop")
          }),
        { git: true },
      ),
    )
  }
})
