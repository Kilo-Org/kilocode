import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { MessageV2 } from "@/session/message-v2"
import { KiloSessionRevert } from "@/kilocode/session/revert"
import { SessionRevert } from "@/session/revert"
import { MessageID, PartID } from "@/session/schema"
import { Session } from "@/session/session"
import { Snapshot } from "@/snapshot"
import { provideInstance, provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const env = LayerNode.compile(
  LayerNode.group([
    Session.node,
    SessionProjector.node,
    SessionRevert.node,
    Snapshot.node,
    CrossSpawnSpawner.node,
  ]),
)
const it = testEffect(env)
const guarded = process.platform === "win32" ? it.live.skip : it.live

const setup = Effect.fnUntraced(function* (dir: string, deleted = false) {
  const sessions = yield* Session.Service
  const revert = yield* SessionRevert.Service
  const snapshot = yield* Snapshot.Service
  const session = yield* sessions.create({})
  const locked = path.join(dir, "locked")
  const protectedFile = path.join(locked, "protected.txt")
  const writableFile = path.join(dir, "writable.txt")
  const providerID = ProviderV2.ID.make("test")
  yield* Effect.promise(() => fs.mkdir(locked))
  yield* Effect.promise(() => fs.writeFile(protectedFile, "before"))
  yield* Effect.promise(() => fs.writeFile(writableFile, "before"))
  const user = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    sessionID: session.id,
    role: "user",
    agent: "default",
    model: { providerID, modelID: ModelV2.ID.make("test") },
    time: { created: Date.now() },
  })
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: user.id,
    sessionID: session.id,
    type: "text",
    text: "change both files",
  })
  const assistant = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    sessionID: session.id,
    role: "assistant",
    parentID: user.id,
    mode: "default",
    agent: "default",
    path: { cwd: dir, root: dir },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ModelV2.ID.make("test"),
    providerID,
    time: { created: Date.now() },
    finish: "end_turn",
  })
  const before = yield* snapshot.track()
  if (!before) throw new Error("expected snapshot")
  if (deleted) yield* Effect.promise(() => fs.rm(protectedFile))
  if (!deleted) yield* Effect.promise(() => fs.writeFile(protectedFile, "after"))
  yield* Effect.promise(() => fs.writeFile(writableFile, "after"))
  const after = yield* snapshot.track()
  if (!after) throw new Error("expected snapshot")
  const patch = yield* snapshot.patch(before)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID: session.id,
    type: "step-start",
    snapshot: before,
  })
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID: session.id,
    type: "step-finish",
    reason: "stop",
    snapshot: after,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID: session.id,
    type: "patch",
    hash: patch.hash,
    files: patch.files,
  })
  return {
    sessions,
    revert,
    snapshot,
    session,
    user,
    after,
    patch,
    locked,
    protected: protectedFile,
    writable: writableFile,
  }
})

describe("partial assistant revert", () => {
  it.live(
    "clears provider errors when the revert becomes permanent",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const session = yield* sessions.create({})
          const providerID = ProviderV2.ID.make("test")
          const user = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "user",
            agent: "default",
            model: { providerID, modelID: ModelV2.ID.make("test") },
            time: { created: Date.now() },
          })
          const assistant = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "assistant",
            parentID: user.id,
            mode: "default",
            agent: "default",
            path: { cwd: dir, root: dir },
            cost: 1,
            tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: ModelV2.ID.make("test"),
            providerID,
            time: { created: Date.now(), completed: Date.now() },
            finish: "error",
            error: MessageV2.fromError(new Error("Provider returned error"), { providerID }),
          })
          const kept = yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: assistant.id,
            sessionID: session.id,
            type: "text",
            text: "keep",
          })
          const boundary = yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: assistant.id,
            sessionID: session.id,
            type: "text",
            text: "remove",
          })

          yield* sessions.setRevert({
            sessionID: session.id,
            revert: { messageID: assistant.id, partID: boundary.id },
            summary: { additions: 0, deletions: 0, files: 0 },
          })
          yield* revert.cleanup(yield* sessions.get(session.id))

          const messages = yield* sessions.messages({ sessionID: session.id })
          const result = messages.find((message) => message.info.id === assistant.id)
          expect(result?.parts.map((part) => part.id)).toEqual([kept.id])
          expect(result?.info).not.toHaveProperty("error")
        }),
      { git: true },
    ),
  )
})

describe("workspace revert status", () => {
  it.live(
    "reports disabled snapshots when conversation-only revert leaves files unchanged",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const session = yield* sessions.create({})
          const file = path.join(dir, "created.txt")
          const providerID = ProviderV2.ID.make("test")
          yield* Effect.promise(() => fs.writeFile(file, "created"))
          const user = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "user",
            agent: "default",
            model: { providerID, modelID: ModelV2.ID.make("test") },
            time: { created: Date.now() },
          })
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: user.id,
            sessionID: session.id,
            type: "text",
            text: "create a file",
          })

          const result = yield* revert.revert({ sessionID: session.id, messageID: user.id })

          expect(result.revert?.workspace).toBe("snapshots-disabled")
          expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("created")
        }),
      { git: true, config: { snapshot: false } },
    ),
  )

  it.live(
    "reports unavailable when historical turns have no file checkpoint",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const session = yield* sessions.create({})
          const file = path.join(dir, "created.txt")
          const providerID = ProviderV2.ID.make("test")
          yield* Effect.promise(() => fs.writeFile(file, "created"))
          const user = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "user",
            agent: "default",
            model: { providerID, modelID: ModelV2.ID.make("test") },
            time: { created: Date.now() },
          })
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: user.id,
            sessionID: session.id,
            type: "text",
            text: "create a file",
          })

          const result = yield* revert.revert({ sessionID: session.id, messageID: user.id })

          expect(result.revert?.workspace).toBe("unavailable")
          expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("created")
        }),
      { git: true },
    ),
  )

  it.live(
    "reports restored when historical patches restore a file",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const snapshot = yield* Snapshot.Service
          const session = yield* sessions.create({})
          const file = path.join(dir, "tracked.txt")
          const providerID = ProviderV2.ID.make("test")
          yield* Effect.promise(() => fs.writeFile(file, "before"))
          const user = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "user",
            agent: "default",
            model: { providerID, modelID: ModelV2.ID.make("test") },
            time: { created: Date.now() },
          })
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: user.id,
            sessionID: session.id,
            type: "text",
            text: "change a file",
          })
          const assistant = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            sessionID: session.id,
            role: "assistant",
            parentID: user.id,
            mode: "default",
            agent: "default",
            path: { cwd: dir, root: dir },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: ModelV2.ID.make("test"),
            providerID,
            time: { created: Date.now() },
            finish: "end_turn",
          })
          const before = yield* snapshot.track()
          if (!before) throw new Error("expected snapshot")
          yield* Effect.promise(() => fs.writeFile(file, "after"))
          const after = yield* snapshot.track()
          if (!after) throw new Error("expected snapshot")
          const patch = yield* snapshot.patch(before)
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: assistant.id,
            sessionID: session.id,
            type: "step-start",
            snapshot: before,
          })
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: assistant.id,
            sessionID: session.id,
            type: "step-finish",
            reason: "stop",
            snapshot: after,
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          })
          yield* sessions.updatePart({
            id: PartID.ascending(),
            messageID: assistant.id,
            sessionID: session.id,
            type: "patch",
            hash: patch.hash,
            files: patch.files,
          })

          const result = yield* revert.revert({ sessionID: session.id, messageID: user.id })

          expect(result.revert?.workspace).toBe("restored")
          expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("before")
        }),
      { git: true },
    ),
  )

  guarded(
    "keeps the conversation and workspace unchanged when a checkpoint cannot be fully restored",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const item = yield* setup(dir)
          yield* Effect.promise(() => fs.chmod(item.protected, 0o444))
          yield* Effect.promise(() => fs.chmod(item.locked, 0o555))
          const outcome = yield* item.revert.revert({ sessionID: item.session.id, messageID: item.user.id }).pipe(
            Effect.exit,
            Effect.ensuring(
              Effect.promise(async () => {
                await fs.chmod(item.locked, 0o755)
                await fs.chmod(item.protected, 0o644)
              }),
            ),
          )
          const current = yield* item.sessions.get(item.session.id)
          const actual = {
            failed: Exit.isFailure(outcome),
            reverted: current.revert !== undefined,
            protected: yield* Effect.promise(() => fs.readFile(item.protected, "utf8")),
            writable: yield* Effect.promise(() => fs.readFile(item.writable, "utf8")),
          }

          expect(actual).toEqual({
            failed: true,
            reverted: false,
            protected: "after",
            writable: "after",
          })
        }),
      { git: true },
    ),
    30_000,
  )

  guarded(
    "keeps the reverted state when unrevert cannot fully restore files",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const item = yield* setup(dir)
          yield* item.revert.revert({ sessionID: item.session.id, messageID: item.user.id })
          yield* Effect.promise(() => fs.chmod(item.protected, 0o444))
          yield* Effect.promise(() => fs.chmod(item.locked, 0o555))
          const outcome = yield* item.revert.unrevert({ sessionID: item.session.id }).pipe(
            Effect.exit,
            Effect.ensuring(
              Effect.promise(async () => {
                await fs.chmod(item.locked, 0o755)
                await fs.chmod(item.protected, 0o644)
              }),
            ),
          )
          const current = yield* item.sessions.get(item.session.id)

          expect({
            failed: Exit.isFailure(outcome),
            reverted: current.revert !== undefined,
            protected: yield* Effect.promise(() => fs.readFile(item.protected, "utf8")),
            writable: yield* Effect.promise(() => fs.readFile(item.writable, "utf8")),
          }).toEqual({ failed: true, reverted: true, protected: "before", writable: "before" })
        }),
      { git: true },
    ),
    30_000,
  )

  guarded(
    "keeps the prior revert when replacing its checkpoint cannot restore files",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const item = yield* setup(dir)
          yield* item.revert.revert({ sessionID: item.session.id, messageID: item.user.id })
          yield* Effect.promise(() => fs.chmod(item.protected, 0o444))
          yield* Effect.promise(() => fs.chmod(item.locked, 0o555))
          const outcome = yield* item.revert.revert({ sessionID: item.session.id, messageID: item.user.id }).pipe(
            Effect.exit,
            Effect.ensuring(
              Effect.promise(async () => {
                await fs.chmod(item.locked, 0o755)
                await fs.chmod(item.protected, 0o644)
              }),
            ),
          )
          const current = yield* item.sessions.get(item.session.id)

          expect({
            failed: Exit.isFailure(outcome),
            reverted: current.revert !== undefined,
            protected: yield* Effect.promise(() => fs.readFile(item.protected, "utf8")),
            writable: yield* Effect.promise(() => fs.readFile(item.writable, "utf8")),
          }).toEqual({ failed: true, reverted: true, protected: "before", writable: "before" })
        }),
      { git: true },
    ),
    30_000,
  )

  it.live(
    "unreverts deleted files from a session rooted in a worktree subdirectory",
    provideTmpdirInstance(
      (root) =>
        Effect.gen(function* () {
          const dir = path.join(root, "nested")
          yield* Effect.promise(() => fs.mkdir(dir))
          const item = yield* setup(dir, true)
          yield* item.revert.revert({ sessionID: item.session.id, messageID: item.user.id })
          expect(yield* Effect.promise(() => fs.readFile(item.protected, "utf8"))).toBe("before")

          yield* KiloSessionRevert.restore(item.snapshot, item.after, item.patch.files).pipe(provideInstance(dir))

          expect(
            yield* Effect.promise(() =>
              fs.stat(item.protected).then(
                () => true,
                () => false,
              ),
            ),
          ).toBe(false)
          expect(yield* Effect.promise(() => fs.readFile(item.writable, "utf8"))).toBe("after")
        }),
      { git: true },
    ),
    30_000,
  )
})
