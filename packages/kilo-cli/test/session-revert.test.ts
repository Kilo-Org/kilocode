import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath, RelativePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { Snapshot } from "@opencode/core/snapshot"
import { Money } from "@opencode/schema/money"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Hash } from "@opencode/util/hash"
import { Effect, Exit } from "effect"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { offlineModels } from "../../core/test/fixture/models"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { testEffect } from "../../core/test/lib/effect"
import { KiloHost } from "../src/host"
import { KiloSessionRevert } from "../src/session-revert"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Global.node,
      Database.node,
      Bus.node,
      SessionProjector.node,
      Session.node,
      SessionStore.node,
      LocationServiceMap.node,
    ]),
    [
      ...KiloHost.overrides,
      Bus.node.replace(Bus.configured({ persist: true })),
      Global.node.replace(tempGlobalLayer),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      offlineModels,
    ],
  ),
)

const guarded = process.platform === "win32" ? it.live.skip : it.live

const initGit = (directory: string) =>
  Effect.promise(async () => {
    await fs.mkdir(directory, { recursive: true })
    await $`git init -q`.cwd(directory).quiet()
    await $`git -c core.fsmonitor=false add .`.cwd(directory).quiet()
  })

const recordTurn = Effect.fnUntraced(function* (input: {
  session: Session.Info
  text: string
  mutate?: () => Promise<void>
}) {
  const sessions = yield* Session.Service
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const prompt = yield* sessions.prompt({ sessionID: input.session.id, text: input.text, resume: false })
  yield* SessionInbox.promote(database.db, bus, input.session.id, "steer")

  const step = yield* Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    yield* plugins.awaitActivation
    const snapshot = yield* Snapshot.Service
    const before = input.mutate ? yield* snapshot.capture() : undefined
    if (input.mutate) yield* Effect.promise(input.mutate)
    const after = input.mutate ? yield* snapshot.capture() : undefined
    const assistantMessageID = SessionMessage.ID.create()
    yield* bus.publish(SessionEvent.Step.Started, {
      sessionID: input.session.id,
      assistantMessageID,
      agent: Agent.defaultID,
      model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test-provider") },
      snapshot: before,
      started: 0,
    })
    yield* bus.publish(SessionEvent.Step.Ended, {
      sessionID: input.session.id,
      assistantMessageID,
      finish: "stop",
      cost: Money.USD.zero,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      snapshot: after,
      files: before && after ? yield* snapshot.files({ from: before, to: after }) : undefined,
    })
    return { before, after, assistantMessageID }
  }).pipe(Effect.provide(LocationServiceMap.Service.get(input.session.location)))

  return { prompt, ...step }
})

const setupTwoFiles = Effect.fnUntraced(function* (directory: string, deleted = false) {
  const locked = path.join(directory, "locked")
  const protectedFile = path.join(locked, "protected.txt")
  const writableFile = path.join(directory, "writable.txt")
  yield* Effect.promise(async () => {
    await fs.mkdir(locked, { recursive: true })
    await Bun.write(protectedFile, "before")
    await Bun.write(writableFile, "before")
  })
  yield* initGit(directory)

  const sessions = yield* Session.Service
  const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
  const turn = yield* recordTurn({
    session: created,
    text: "change both files",
    mutate: async () => {
      if (deleted) await fs.rm(protectedFile)
      else await Bun.write(protectedFile, "after")
      await Bun.write(writableFile, "after")
    },
  })
  return {
    sessions,
    session: created,
    prompt: turn.prompt,
    after: turn.after,
    locked,
    protectedFile,
    writableFile,
  }
})

describe("KiloSessionRevert workspace outcomes", () => {
  it.live(
    "reports snapshots-disabled when conversation-only revert leaves files unchanged",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "project")
        const file = path.join(directory, "created.txt")
        yield* initGit(directory)
        yield* Effect.promise(async () => {
          await Bun.write(file, "before")
        })

        const sessions = yield* Session.Service
        const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const first = yield* recordTurn({
          session: created,
          text: "edit before disabling snapshots",
          mutate: async () => {
            await Bun.write(file, "after")
          },
        })

        yield* Effect.promise(async () => {
          await Bun.write(path.join(directory, "kilo2.json"), JSON.stringify({ snapshots: false }))
        })
        yield* LocationServiceMap.reload()

        const reverted = yield* sessions.revert.stage({ sessionID: created.id, messageID: first.prompt.id })
        expect(reverted.workspace).toBe("snapshots-disabled")
        expect(reverted.files).toEqual([])
        expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("after")
        expect((yield* sessions.get(created.id)).revert?.workspace).toBe("snapshots-disabled")
      }),
    { timeout: 20_000 },
  )

  it.live(
    "reports unavailable when historical turns have no file checkpoint",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "project")
        const file = path.join(directory, "created.txt")
        yield* initGit(directory)
        yield* Effect.promise(async () => {
          await Bun.write(file, "created")
        })

        const sessions = yield* Session.Service
        const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const prompt = yield* sessions.prompt({ sessionID: created.id, text: "create a file", resume: false })
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        yield* SessionInbox.promote(database.db, bus, created.id, "steer")

        const reverted = yield* sessions.revert.stage({ sessionID: created.id, messageID: prompt.id })
        expect(reverted.workspace).toBe("unavailable")
        expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("created")
      }),
    { timeout: 15_000 },
  )

  it.live(
    "reports not-a-git-repo when the workspace is not a Git repository",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "plain")
        const file = path.join(directory, "created.txt")
        yield* Effect.promise(async () => {
          await fs.mkdir(directory, { recursive: true })
          await Bun.write(file, "created")
        })

        const sessions = yield* Session.Service
        const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const prompt = yield* sessions.prompt({ sessionID: created.id, text: "create a file", resume: false })
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        yield* SessionInbox.promote(database.db, bus, created.id, "steer")

        const reverted = yield* sessions.revert.stage({ sessionID: created.id, messageID: prompt.id })
        expect(reverted.workspace).toBe("not-a-git-repo")
        expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("created")
      }),
    { timeout: 15_000 },
  )

  it.live(
    "restores checkpoints to specific messages and steps forward with redo and clear",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "project")
        const firstFile = path.join(directory, "first.txt")
        const secondFile = path.join(directory, "second.txt")
        yield* Effect.promise(async () => {
          await fs.mkdir(directory, { recursive: true })
          await Bun.write(firstFile, "v0")
        })
        yield* initGit(directory)

        const sessions = yield* Session.Service
        const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const turn1 = yield* recordTurn({
          session: created,
          text: "turn 1",
          mutate: async () => {
            await Bun.write(firstFile, "v1")
          },
        })
        const turn2 = yield* recordTurn({
          session: created,
          text: "turn 2",
          mutate: async () => {
            await Bun.write(firstFile, "v2")
            await Bun.write(secondFile, "added-in-turn-2")
          },
        })

        const atTurn1 = yield* sessions.revert.stage({ sessionID: created.id, messageID: turn1.prompt.id })
        expect(atTurn1.workspace).toBe("restored")
        expect(yield* Effect.promise(() => Bun.file(firstFile).text())).toBe("v0")
        expect(yield* Effect.promise(() => Bun.file(secondFile).exists())).toBe(false)

        const atTurn2 = yield* sessions.revert.stage({ sessionID: created.id, messageID: turn2.prompt.id })
        expect(atTurn2.workspace).toBe("restored")
        expect(yield* Effect.promise(() => Bun.file(firstFile).text())).toBe("v1")
        expect(yield* Effect.promise(() => Bun.file(secondFile).exists())).toBe(false)

        yield* sessions.revert.clear(created.id)
        expect((yield* sessions.get(created.id)).revert).toBeUndefined()
        expect(yield* Effect.promise(() => Bun.file(firstFile).text())).toBe("v2")
        expect(yield* Effect.promise(() => Bun.file(secondFile).text())).toBe("added-in-turn-2")
      }),
    { timeout: 20_000 },
  )

  it.live(
    "a whole-session fork of a reverted session stops at the revert boundary",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "project")
        yield* Effect.promise(async () => {
          await fs.mkdir(directory, { recursive: true })
          await Bun.write(path.join(directory, "file.txt"), "v0")
        })
        yield* initGit(directory)

        const sessions = yield* Session.Service
        const store = yield* SessionStore.Service
        const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const turn1 = yield* recordTurn({ session: created, text: "turn 1" })
        const turn2 = yield* recordTurn({ session: created, text: "turn 2" })
        yield* sessions.revert.stage({ sessionID: created.id, messageID: turn2.prompt.id })

        const texts = (sessionID: Session.ID) =>
          store
            .messages({ sessionID, order: "asc", type: "user" })
            .pipe(Effect.map((list) => list.flatMap((message) => (message.type === "user" ? [message.text] : []))))

        const forked = yield* sessions.fork({ sessionID: created.id })
        expect(yield* texts(forked.id)).toEqual(["turn 1"])
        expect(forked.revert).toBeUndefined()

        const explicit = yield* sessions.fork({ sessionID: created.id, before: turn1.prompt.id })
        expect(yield* texts(explicit.id)).toEqual([])

        yield* sessions.revert.clear(created.id)
        const full = yield* sessions.fork({ sessionID: created.id })
        expect(yield* texts(full.id)).toEqual(["turn 1", "turn 2"])
      }),
    { timeout: 20_000 },
  )

  it.live(
    "restores a moved file and moves it again on redo",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "project")
        const from = path.join(directory, "from.txt")
        const to = path.join(directory, "to.txt")
        yield* Effect.promise(async () => {
          await fs.mkdir(directory, { recursive: true })
          await Bun.write(from, "content")
        })
        yield* initGit(directory)

        const sessions = yield* Session.Service
        const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const turn = yield* recordTurn({
          session: created,
          text: "move the file",
          mutate: () => fs.rename(from, to),
        })

        yield* sessions.revert.stage({ sessionID: created.id, messageID: turn.prompt.id })
        expect(yield* Effect.promise(() => Bun.file(from).text())).toBe("content")
        expect(yield* Effect.promise(() => Bun.file(to).exists())).toBe(false)

        yield* sessions.revert.clear(created.id)
        expect(yield* Effect.promise(() => Bun.file(from).exists())).toBe(false)
        expect(yield* Effect.promise(() => Bun.file(to).text())).toBe("content")
      }),
    { timeout: 20_000 },
  )

  it.live(
    "a new prompt after a revert drops the reverted turns and keeps the restored files",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "project")
        const file = path.join(directory, "file.txt")
        yield* Effect.promise(async () => {
          await fs.mkdir(directory, { recursive: true })
          await Bun.write(file, "v0")
        })
        yield* initGit(directory)

        const sessions = yield* Session.Service
        const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const turn1 = yield* recordTurn({
          session: created,
          text: "turn 1",
          mutate: () => Bun.write(file, "v1").then(() => undefined),
        })
        const turn2 = yield* recordTurn({
          session: created,
          text: "turn 2",
          mutate: () => Bun.write(file, "v2").then(() => undefined),
        })

        yield* sessions.revert.stage({ sessionID: created.id, messageID: turn2.prompt.id })
        expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("v1")
        const resubmitted = yield* sessions.prompt({ sessionID: created.id, text: "turn 2 again", resume: false })

        const session = yield* sessions.get(created.id)
        expect(session.revert).toBeUndefined()
        const store = yield* SessionStore.Service
        const ids = (yield* store.messages({ sessionID: created.id, order: "asc" })).map((message) => message.id)
        expect(ids).toContain(turn1.prompt.id)
        expect(ids).toContain(turn1.assistantMessageID)
        expect(ids).not.toContain(turn2.prompt.id)
        expect(ids).not.toContain(turn2.assistantMessageID)
        expect(resubmitted.id).not.toBe(turn2.prompt.id)
        expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("v1")
      }),
    { timeout: 20_000 },
  )
})

describe("KiloSessionRevert atomicity", () => {
  guarded(
    "keeps the conversation and workspace unchanged when a checkpoint cannot be fully restored",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const item = yield* setupTwoFiles(path.join(tmp.path, "project"))
        yield* Effect.promise(async () => {
          await fs.chmod(item.protectedFile, 0o444)
          await fs.chmod(item.locked, 0o555)
        })
        const outcome = yield* item.sessions.revert
          .stage({ sessionID: item.session.id, messageID: item.prompt.id })
          .pipe(
            Effect.exit,
            Effect.ensuring(
              Effect.promise(async () => {
                await fs.chmod(item.locked, 0o755)
                await fs.chmod(item.protectedFile, 0o644)
              }),
            ),
          )
        const current = yield* item.sessions.get(item.session.id)
        expect({
          failed: Exit.isFailure(outcome),
          reverted: current.revert !== undefined,
          protected: yield* Effect.promise(() => Bun.file(item.protectedFile).text()),
          writable: yield* Effect.promise(() => Bun.file(item.writableFile).text()),
        }).toEqual({
          failed: true,
          reverted: false,
          protected: "after",
          writable: "after",
        })
      }),
    { timeout: 25_000 },
  )

  guarded(
    "keeps the reverted state when clear cannot fully restore files",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const item = yield* setupTwoFiles(path.join(tmp.path, "project"))
        yield* item.sessions.revert.stage({ sessionID: item.session.id, messageID: item.prompt.id })
        yield* Effect.promise(async () => {
          await fs.chmod(item.protectedFile, 0o444)
          await fs.chmod(item.locked, 0o555)
        })
        const outcome = yield* item.sessions.revert.clear(item.session.id).pipe(
          Effect.exit,
          Effect.ensuring(
            Effect.promise(async () => {
              await fs.chmod(item.locked, 0o755)
              await fs.chmod(item.protectedFile, 0o644)
            }),
          ),
        )
        const current = yield* item.sessions.get(item.session.id)
        expect({
          failed: Exit.isFailure(outcome),
          reverted: current.revert !== undefined,
          protected: yield* Effect.promise(() => Bun.file(item.protectedFile).text()),
          writable: yield* Effect.promise(() => Bun.file(item.writableFile).text()),
        }).toEqual({
          failed: true,
          reverted: true,
          protected: "before",
          writable: "before",
        })
      }),
    { timeout: 25_000 },
  )

  guarded(
    "keeps the prior revert when replacing its checkpoint cannot restore files",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "project")
        const item = yield* setupTwoFiles(directory)
        const second = yield* recordTurn({
          session: item.session,
          text: "second edit",
          mutate: async () => {
            await Bun.write(item.writableFile, "third")
          },
        })
        yield* item.sessions.revert.stage({ sessionID: item.session.id, messageID: item.prompt.id })
        yield* Effect.promise(async () => {
          await fs.chmod(item.protectedFile, 0o444)
          await fs.chmod(item.locked, 0o555)
        })
        const outcome = yield* item.sessions.revert
          .stage({ sessionID: item.session.id, messageID: second.prompt.id })
          .pipe(
            Effect.exit,
            Effect.ensuring(
              Effect.promise(async () => {
                await fs.chmod(item.locked, 0o755)
                await fs.chmod(item.protectedFile, 0o644)
              }),
            ),
          )
        const current = yield* item.sessions.get(item.session.id)
        expect({
          failed: Exit.isFailure(outcome),
          boundary: current.revert?.messageID,
          protected: yield* Effect.promise(() => Bun.file(item.protectedFile).text()),
          writable: yield* Effect.promise(() => Bun.file(item.writableFile).text()),
        }).toEqual({
          failed: true,
          boundary: item.prompt.id,
          protected: "before",
          writable: "before",
        })
      }),
    { timeout: 25_000 },
  )

  it.live(
    "unreverts deleted files from a session rooted in a worktree subdirectory",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const root = path.join(tmp.path, "repo")
        const nested = path.join(root, "nested")
        yield* initGit(root)
        yield* Effect.promise(() => fs.mkdir(nested, { recursive: true }))

        const protectedFile = path.join(nested, "protected.txt")
        const writableFile = path.join(nested, "writable.txt")
        yield* Effect.promise(async () => {
          await Bun.write(protectedFile, "before")
          await Bun.write(writableFile, "before")
        })

        const sessions = yield* Session.Service
        const created = yield* sessions.create({ location: { directory: AbsolutePath.make(nested) } })
        const turn = yield* recordTurn({
          session: created,
          text: "delete and edit in subdir",
          mutate: async () => {
            await fs.rm(protectedFile)
            await Bun.write(writableFile, "after")
          },
        })

        yield* sessions.revert.stage({ sessionID: created.id, messageID: turn.prompt.id })
        expect(yield* Effect.promise(() => Bun.file(protectedFile).text())).toBe("before")

        yield* sessions.revert.clear(created.id)
        expect(yield* Effect.promise(() => Bun.file(protectedFile).exists())).toBe(false)
        expect(yield* Effect.promise(() => Bun.file(writableFile).text())).toBe("after")
      }),
    { timeout: 20_000 },
  )

  guarded(
    "fails instead of rewinding when the pre-revert workspace snapshot cannot be captured",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "project")
        const item = yield* setupTwoFiles(directory)
        const global = yield* Global.Service
        const real = yield* Effect.promise(() => fs.realpath(directory))
        const gitdir = path.join(global.data, "snapshot", item.session.projectID, Hash.fast(real))
        yield* Effect.promise(async () => {
          await Bun.write(item.writableFile, "dirty-uncommitted-edit")
          await fs.chmod(gitdir, 0o555)
        })

        const outcome = yield* item.sessions.revert
          .stage({ sessionID: item.session.id, messageID: item.prompt.id })
          .pipe(
            Effect.exit,
            Effect.ensuring(Effect.promise(() => fs.chmod(gitdir, 0o755))),
          )
        const current = yield* item.sessions.get(item.session.id)
        expect({
          failed: Exit.isFailure(outcome),
          reverted: current.revert !== undefined,
          writable: yield* Effect.promise(() => Bun.file(item.writableFile).text()),
        }).toEqual({
          failed: true,
          reverted: false,
          writable: "dirty-uncommitted-edit",
        })
      }),
    { timeout: 25_000 },
  )

  it.live(
    "combines causes when both the operation and its rollback fail",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const item = yield* setupTwoFiles(path.join(tmp.path, "project"))
        const global = yield* Global.Service
        const real = yield* Effect.promise(() => fs.realpath(path.join(tmp.path, "project")))
        const gitdir = path.join(global.data, "snapshot", item.session.projectID, Hash.fast(real))

        const outcome = yield* Effect.gen(function* () {
          const snapshot = yield* Snapshot.Service
          yield* Effect.promise(() => fs.chmod(gitdir, 0o555))
          return yield* KiloSessionRevert.apply(
            snapshot,
            item.after,
            [RelativePath.make("writable.txt")],
            Effect.fail(new Error("primary failure")),
          ).pipe(
            Effect.exit,
            Effect.ensuring(Effect.promise(() => fs.chmod(gitdir, 0o755))),
          )
        }).pipe(Effect.provide(LocationServiceMap.Service.get(item.session.location)))

        expect(Exit.isFailure(outcome)).toBe(true)
      }),
    { timeout: 20_000 },
  )
})
