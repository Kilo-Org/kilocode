import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Schema } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { Session } from "@/session/session"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Snapshot } from "@/snapshot"
import { InstanceState } from "@/effect/instance-state"
import { Storage } from "@/storage/storage"
import { KiloSessionRevert } from "@/kilocode/session/revert"
import { provideInstance, provideTmpdirInstance } from "../../fixture/fixture"
import { pollWithTimeout, testEffect } from "../../lib/effect"

const decodeTrace = Schema.decodeUnknownSync(
  Schema.Struct({ event: Schema.String, argv: Schema.optional(Schema.Array(Schema.String)) }),
)

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Session.node,
      SessionProjector.node,
      SessionRevert.node,
      SessionRunState.node,
      Snapshot.node,
      Storage.node,
      CrossSpawnSpawner.node,
    ]),
  ),
)
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
const providerID = ProviderV2.ID.make("test")
const modelID = ModelV2.ID.make("test")

const user = Effect.fnUntraced(function* (sessionID: SessionID, at = Date.now()) {
  const sessions = yield* Session.Service
  const msg = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    agent: "default",
    model: { providerID, modelID },
    time: { created: at },
  })
  yield* sessions.updatePart({ id: PartID.ascending(), sessionID, messageID: msg.id, type: "text", text: "edit" })
  return msg
})

const assistant = Effect.fnUntraced(function* (sessionID: SessionID, parentID: MessageID, at = Date.now()) {
  const ctx = yield* InstanceState.context
  return yield* (yield* Session.Service).updateMessage({
    id: MessageID.ascending(),
    sessionID,
    parentID,
    role: "assistant",
    agent: "default",
    mode: "default",
    path: { cwd: ctx.directory, root: ctx.worktree },
    providerID,
    modelID,
    cost: 0,
    tokens,
    time: { created: at },
    finish: "end_turn",
  })
})

const text = Effect.fnUntraced(function* (msg: { id: MessageID; sessionID: SessionID }) {
  return yield* (yield* Session.Service).updatePart({
    id: PartID.ascending(),
    sessionID: msg.sessionID,
    messageID: msg.id,
    type: "text",
    text: "boundary",
  })
})

const task = Effect.fnUntraced(function* (
  msg: { id: MessageID; sessionID: SessionID },
  child: SessionID,
  at = Date.now(),
) {
  return yield* (yield* Session.Service).updatePart({
    id: PartID.ascending(),
    sessionID: msg.sessionID,
    messageID: msg.id,
    type: "tool",
    tool: "task",
    callID: child,
    state: {
      status: "completed",
      input: {},
      title: "task",
      output: "done",
      metadata: { sessionId: child },
      time: { start: at, end: at },
    },
  })
})

const start = Effect.fnUntraced(function* (msg: { id: MessageID; sessionID: SessionID }) {
  const hash = yield* (yield* Snapshot.Service).track()
  if (!hash) throw new Error("expected snapshot")
  yield* (yield* Session.Service).updatePart({
    id: PartID.ascending(),
    sessionID: msg.sessionID,
    messageID: msg.id,
    type: "step-start",
    snapshot: hash,
  })
  return hash
})

const finish = Effect.fnUntraced(function* (msg: { id: MessageID; sessionID: SessionID }, hash: string) {
  const snap = yield* Snapshot.Service
  const sessions = yield* Session.Service
  const after = yield* snap.track()
  if (!after) throw new Error("expected snapshot")
  yield* sessions.updatePart({
    id: PartID.ascending(),
    sessionID: msg.sessionID,
    messageID: msg.id,
    type: "step-finish",
    snapshot: after,
    reason: "stop",
    cost: 0,
    tokens,
  })
  const patch = yield* snap.patch(hash)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    sessionID: msg.sessionID,
    messageID: msg.id,
    type: "patch",
    ...patch,
  })
})

const edit = Effect.fnUntraced(function* (msg: { id: MessageID; sessionID: SessionID }, file: string, content: string) {
  const hash = yield* start(msg)
  yield* Effect.promise(() => fs.writeFile(file, content))
  yield* finish(msg, hash)
})
const read = (file: string) => Effect.promise(() => fs.readFile(file, "utf8"))

describe("descendant revert regressions", () => {
  it.live(
    "does not resurrect edits from a discarded child branch",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const file = path.join(dir, "shared.txt")
          yield* Effect.promise(() => fs.writeFile(file, "before"))
          const parent = yield* sessions.create({})
          const retained = yield* user(parent.id, 1)
          const discarded = yield* user(parent.id, 2)
          const msg = yield* assistant(parent.id, discarded.id, 3)
          yield* edit(msg, file, "discarded")
          const child = yield* sessions.create({ parentID: parent.id })
          yield* task(msg, child.id)
          const prompt = yield* user(child.id, 4)
          yield* edit(yield* assistant(child.id, prompt.id, 5), file, "child")
          const undone = yield* revert.revert({ sessionID: parent.id, messageID: discarded.id })
          expect(yield* read(file)).toBe("before")
          yield* revert.cleanup(undone)
          yield* user(parent.id, 6)
          yield* revert.revert({ sessionID: parent.id, messageID: retained.id })
          expect(yield* read(file)).toBe("before")
          // Keep the child session as inspectable history; only its discarded patches are invalidated.
          expect((yield* sessions.messages({ sessionID: child.id })).length).toBe(2)
        }),
      { git: true },
    ),
    30_000,
  )

  it.live(
    "keeps child work delegated before a partial part boundary",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const childfile = path.join(dir, "child.txt")
          const ownfile = path.join(dir, "own.txt")
          yield* Effect.promise(() => Promise.all([fs.writeFile(childfile, "before"), fs.writeFile(ownfile, "before")]))
          const parent = yield* sessions.create({})
          const prompt = yield* user(parent.id, 1)
          const msg = yield* assistant(parent.id, prompt.id, 2)
          yield* text(msg)
          const child = yield* sessions.create({ parentID: parent.id })
          const childprompt = yield* user(child.id, 3)
          yield* edit(yield* assistant(child.id, childprompt.id, 4), childfile, "retained")
          yield* task(msg, child.id)
          const boundary = yield* text(msg)
          yield* edit(msg, ownfile, "later")
          const undone = yield* revert.revert({ sessionID: parent.id, messageID: msg.id, partID: boundary.id })
          expect(undone.revert?.partID).toBe(boundary.id)
          expect(yield* read(childfile)).toBe("retained")
          expect(yield* read(ownfile)).toBe("before")
          yield* revert.unrevert({ sessionID: parent.id })
          expect(yield* read(childfile)).toBe("retained")
          expect(yield* read(ownfile)).toBe("later")
        }),
      { git: true },
    ),
    30_000,
  )

  it.live(
    "keeps the earlier invocation of a child resumed after a partial boundary",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const file = path.join(dir, "resumed.txt")
          yield* Effect.promise(() => fs.writeFile(file, "before"))
          const parent = yield* sessions.create({})
          const prompt = yield* user(parent.id, 1)
          const msg = yield* assistant(parent.id, prompt.id, 2)
          yield* text(msg)
          const child = yield* sessions.create({ parentID: parent.id })
          yield* task(msg, child.id, 3)
          const first = yield* user(child.id, 3)
          yield* edit(yield* assistant(child.id, first.id, 4), file, "retained")
          const boundary = yield* text(msg)
          yield* task(msg, child.id, 5)
          const second = yield* user(child.id, 5)
          yield* edit(yield* assistant(child.id, second.id, 6), file, "later")
          yield* revert.revert({ sessionID: parent.id, messageID: msg.id, partID: boundary.id })
          expect(yield* read(file)).toBe("retained")
          yield* revert.unrevert({ sessionID: parent.id })
          expect(yield* read(file)).toBe("later")
        }),
      { git: true },
    ),
    30_000,
  )

  it.live(
    "blocks revert and redo for a busy child in a subdirectory",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const run = yield* SessionRunState.Service
          const parent = yield* sessions.create({})
          const prompt = yield* user(parent.id)
          const subdir = path.join(dir, "subdir")
          const file = path.join(dir, "child.txt")
          yield* Effect.promise(() => fs.mkdir(subdir))
          yield* Effect.promise(() => fs.writeFile(file, "before"))
          const child = yield* sessions.create({ parentID: parent.id }).pipe(provideInstance(subdir))
          yield* edit(yield* assistant(child.id, prompt.id), file, "after")
          yield* task(yield* assistant(parent.id, prompt.id), child.id)
          const later = yield* user(parent.id, Date.now() + 1)
          yield* revert.revert({ sessionID: parent.id, messageID: prompt.id })
          const fiber = yield* run
            .ensureRunning(child.id, Effect.never, Effect.never)
            .pipe(provideInstance(subdir), Effect.forkChild)
          yield* pollWithTimeout(
            run.assertNotBusy(child.id).pipe(
              provideInstance(subdir),
              Effect.as(undefined),
              Effect.catchTag("SessionBusyError", () => Effect.succeed(true)),
            ),
            "child never became busy",
          )
          for (const action of [
            revert.revert({ sessionID: parent.id, messageID: prompt.id }),
            revert.revert({ sessionID: parent.id, messageID: later.id }),
            revert.unrevert({ sessionID: parent.id }),
            revert.cleanup(yield* sessions.get(parent.id)),
          ]) {
            const outcome = yield* action.pipe(Effect.exit)
            expect(Exit.isFailure(outcome)).toBe(true)
            if (Exit.isFailure(outcome)) {
              expect(Cause.squash(outcome.cause)).toBeInstanceOf(Session.BusyError)
              expect(Cause.hasDies(outcome.cause)).toBe(false)
            }
            expect(yield* read(file)).toBe("before")
          }
          yield* run.cancel(child.id).pipe(provideInstance(subdir))
          yield* Fiber.interrupt(fiber)
        }),
      { git: true },
    ),
    30_000,
  )

  it.live(
    "excludes checkpoints from linked worktrees",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const parent = yield* sessions.create({})
          const prompt = yield* user(parent.id, 1)
          const ownfile = path.join(dir, "own.txt")
          yield* Effect.promise(() => fs.writeFile(ownfile, "before"))
          yield* edit(yield* assistant(parent.id, prompt.id, 2), ownfile, "after")
          const linked = path.join(dir, "linked")
          yield* Effect.promise(async () => {
            const proc = Bun.spawn(["git", "worktree", "add", "--detach", linked, "HEAD"], {
              cwd: dir,
              windowsHide: true,
              stdout: "pipe",
              stderr: "pipe",
            })
            if ((await proc.exited) !== 0) throw new Error(await new Response(proc.stderr).text())
            await fs.writeFile(path.join(dir, ".gitignore"), "linked/\n")
          })
          const child = yield* sessions.create({ parentID: parent.id }).pipe(provideInstance(linked))
          yield* Effect.gen(function* () {
            const file = path.join(linked, "foreign.txt")
            yield* Effect.promise(() => fs.writeFile(file, "foreign-before"))
            const childprompt = yield* user(child.id, 3)
            yield* edit(yield* assistant(child.id, childprompt.id, 4), file, "foreign-after")
          }).pipe(provideInstance(linked))
          const undone = yield* revert.revert({ sessionID: parent.id, messageID: prompt.id })
          expect(undone.revert?.workspace).toBe("restored")
          expect(yield* read(ownfile)).toBe("before")
          expect(yield* read(path.join(linked, "foreign.txt"))).toBe("foreign-after")
          yield* revert.unrevert({ sessionID: parent.id })
          expect(yield* read(ownfile)).toBe("after")
        }),
      { git: true },
    ),
    30_000,
  )

  for (const transition of ["redo", "later", "earlier", "same"]) {
    it.live(
      `restores deleted-child files on ${transition}`,
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const revert = yield* SessionRevert.Service
            const file = path.join(dir, "child.txt")
            yield* Effect.promise(() => fs.writeFile(file, "before"))
            const parent = yield* sessions.create({})
            const earlier = yield* user(parent.id, 1)
            const prompt = yield* user(parent.id, 2)
            const child = yield* sessions.create({ parentID: parent.id })
            yield* edit(yield* assistant(child.id, prompt.id, 3), file, "after")
            const later = yield* user(parent.id, 4)
            yield* revert.revert({ sessionID: parent.id, messageID: prompt.id })
            expect(yield* read(file)).toBe("before")
            yield* sessions.remove(child.id)
            if (transition === "later") yield* revert.revert({ sessionID: parent.id, messageID: later.id })
            if (transition === "earlier" || transition === "same") {
              yield* revert.revert({
                sessionID: parent.id,
                messageID: transition === "earlier" ? earlier.id : prompt.id,
              })
              expect(yield* read(file)).toBe("before")
            }
            if (transition !== "later") yield* revert.unrevert({ sessionID: parent.id })
            expect(yield* read(file)).toBe("after")
          }),
        { git: true },
      ),
      30_000,
    )
  }

  for (const [transition, legacy] of [
    ["earlier", false],
    ["same", false],
    ["earlier", true],
    ["same", true],
  ] as const) {
    it.live(
      `preserves a deleted child's earlier shared-file baseline on ${transition}${legacy ? " with a legacy saved set" : ""}`,
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const sessions = yield* Session.Service
            const revert = yield* SessionRevert.Service
            const file = path.join(dir, "shared.txt")
            yield* Effect.promise(() => fs.writeFile(file, "before"))
            const parent = yield* sessions.create({})
            const earlier = yield* user(parent.id, 1)
            const prompt = yield* user(parent.id, 2)
            const child = yield* sessions.create({ parentID: parent.id })
            yield* edit(yield* assistant(child.id, prompt.id, 3), file, "child")
            yield* edit(yield* assistant(parent.id, prompt.id, 4), file, "after")
            const undone = yield* revert.revert({ sessionID: parent.id, messageID: prompt.id })
            expect(yield* read(file)).toBe("before")
            if (legacy) {
              if (!undone.revert) throw new Error("expected revert")
              const storage = yield* Storage.Service
              const saved = yield* KiloSessionRevert.saved(storage, parent.id, undone.revert)
              if (!saved) throw new Error("expected saved set")
              yield* KiloSessionRevert.remember(
                storage,
                parent.id,
                undone.revert,
                saved.map(({ revertOrder: _, ...part }) => part),
              )
            }
            yield* sessions.remove(child.id)
            yield* revert.revert({
              sessionID: parent.id,
              messageID: transition === "earlier" ? earlier.id : prompt.id,
            })
            expect(yield* read(file)).toBe("before")
            yield* revert.unrevert({ sessionID: parent.id })
            expect(yield* read(file)).toBe("after")
          }),
        { git: true },
      ),
      30_000,
    )
  }

  it.live(
    "uses one full-tree diff for distinct child baselines",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const files = ["one.txt", "two.txt", "three.txt"].map((name) => path.join(dir, name))
          yield* Effect.promise(() => Promise.all(files.map((file) => fs.writeFile(file, "before\n"))))
          const parent = yield* sessions.create({})
          const prompt = yield* user(parent.id, 1)
          for (const [index, file] of files.entries()) {
            const child = yield* sessions.create({ parentID: parent.id })
            yield* edit(yield* assistant(child.id, prompt.id, index + 2), file, "after\n")
          }
          const trace = path.join(dir, ".git", "revert-trace.jsonl")
          const prior = process.env.GIT_TRACE2_EVENT
          process.env.GIT_TRACE2_EVENT = trace
          const undone = yield* revert.revert({ sessionID: parent.id, messageID: prompt.id }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (prior === undefined) delete process.env.GIT_TRACE2_EVENT
                else process.env.GIT_TRACE2_EVENT = prior
              }),
            ),
          )
          expect(undone.summary?.files).toBe(3)
          for (const file of files) expect(yield* read(file)).toBe("before\n")
          const commands = (yield* read(trace))
            .trim()
            .split("\n")
            .map((line) => decodeTrace(JSON.parse(line)))
          expect(commands.filter((event) => event.event === "start" && event.argv?.includes("--numstat"))).toHaveLength(
            1,
          )
        }),
      { git: true },
    ),
    30_000,
  )

  it.live(
    "prunes inactive undo sets and deleted-session discard markers",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const storage = yield* Storage.Service
          const file = path.join(dir, "child.txt")
          yield* Effect.promise(() => fs.writeFile(file, "before"))
          const parent = yield* sessions.create({})
          yield* user(parent.id, 1)
          const prompt = yield* user(parent.id, 2)
          const child = yield* sessions.create({ parentID: parent.id })
          yield* edit(yield* assistant(child.id, prompt.id, 3), file, "after")
          const later = yield* user(parent.id, 4)
          yield* revert.revert({ sessionID: parent.id, messageID: prompt.id })
          yield* revert.revert({ sessionID: parent.id, messageID: later.id })
          expect((yield* storage.list(["session_revert", parent.id])).length).toBe(1)
          yield* revert.unrevert({ sessionID: parent.id })
          expect(yield* storage.list(["session_revert", parent.id])).toEqual([])
          const undone = yield* revert.revert({ sessionID: parent.id, messageID: prompt.id })
          yield* revert.cleanup(undone)
          expect(yield* storage.list(["session_revert", parent.id])).toEqual([])
          expect((yield* storage.read<string[]>(["session_discarded_patches", child.id])).length).toBe(1)
          yield* sessions.remove(child.id)
          expect(
            yield* storage
              .read(["session_discarded_patches", child.id])
              .pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(undefined))),
          ).toBeUndefined()
          const next = yield* user(parent.id, 5)
          yield* edit(yield* assistant(parent.id, next.id, 6), file, "next")
          yield* revert.revert({ sessionID: parent.id, messageID: next.id })
          expect((yield* storage.list(["session_revert", parent.id])).length).toBe(1)
          yield* sessions.remove(parent.id)
          expect(yield* storage.list(["session_revert", parent.id])).toEqual([])
        }),
      { git: true },
    ),
    30_000,
  )

  it.live(
    "drops a deleted child's own undo set while retaining the parent's",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const storage = yield* Storage.Service
          const ownfile = path.join(dir, "own.txt")
          const childfile = path.join(dir, "child.txt")
          yield* Effect.promise(() => Promise.all([fs.writeFile(ownfile, "before"), fs.writeFile(childfile, "before")]))
          const parent = yield* sessions.create({})
          const prompt = yield* user(parent.id, 1)
          yield* edit(yield* assistant(parent.id, prompt.id, 2), ownfile, "after")
          const child = yield* sessions.create({ parentID: parent.id })
          const childprompt = yield* user(child.id, 3)
          yield* edit(yield* assistant(child.id, childprompt.id, 4), childfile, "after")
          yield* revert.revert({ sessionID: child.id, messageID: childprompt.id })
          yield* revert.revert({ sessionID: parent.id, messageID: prompt.id })
          expect((yield* storage.list(["session_revert", child.id])).length).toBe(1)
          yield* sessions.remove(child.id)
          expect(yield* storage.list(["session_revert", child.id])).toEqual([])
          expect((yield* storage.list(["session_revert", parent.id])).length).toBe(1)
          yield* revert.unrevert({ sessionID: parent.id })
          expect(yield* read(ownfile)).toBe("after")
          expect(yield* read(childfile)).toBe("before")
        }),
      { git: true },
    ),
    30_000,
  )

  it.live(
    "summarizes all restored files when parent and child steps overlap",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const revert = yield* SessionRevert.Service
          const files = ["first.txt", "child.txt", "last.txt"].map((name) => path.join(dir, name))
          yield* Effect.promise(() => Promise.all(files.map((file) => fs.writeFile(file, "before\n"))))
          const parent = yield* sessions.create({})
          const prompt = yield* user(parent.id, 1)
          const msg = yield* assistant(parent.id, prompt.id, 2)
          const hash = yield* start(msg)
          yield* Effect.promise(() => fs.writeFile(files[0], "first\n"))
          const child = yield* sessions.create({ parentID: parent.id })
          const childprompt = yield* user(child.id, 3)
          yield* edit(yield* assistant(child.id, childprompt.id, 4), files[1], "child\n")
          yield* task(msg, child.id)
          yield* Effect.promise(() => fs.writeFile(files[2], "last\n"))
          yield* finish(msg, hash)
          const undone = yield* revert.revert({ sessionID: parent.id, messageID: prompt.id })
          for (const file of files) expect(yield* read(file)).toBe("before\n")
          expect(undone.summary?.files).toBe(3)
          expect(undone.summary?.diffs?.map((diff) => diff.file).sort()).toEqual(["child.txt", "first.txt", "last.txt"])
        }),
      { git: true },
    ),
    30_000,
  )
})
