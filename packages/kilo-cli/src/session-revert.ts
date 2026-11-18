export * as KiloSessionRevert from "./session-revert"

import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Instance } from "@opencode/core/instance/service"
import { Location } from "@opencode/core/location"
import { RelativePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import type { SessionMessage } from "@opencode/schema/session-message"
import { SessionStore } from "@opencode/core/session/store"
import { Snapshot } from "@opencode/core/snapshot"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Cause, Effect, Layer } from "effect"

export const restore = Effect.fn("KiloSessionRevert.restore")(function* (
  snapshot: Snapshot.Interface,
  tree: Snapshot.ID,
  files: readonly RelativePath[],
) {
  if (files.length === 0) return
  yield* snapshot.restore({
    files: new Map(files.map((file) => [file, tree])),
  })
})

export const apply = Effect.fn("KiloSessionRevert.apply")(function* <A, E, R>(
  snapshot: Snapshot.Interface,
  baseline: Snapshot.ID | undefined,
  files: readonly RelativePath[],
  effect: Effect.Effect<A, E, R>,
) {
  return yield* effect.pipe(
    Effect.catchCause((cause) => {
      if (!baseline || files.length === 0) return Effect.failCause(cause)
      return restore(snapshot, baseline, files).pipe(
        Effect.matchCauseEffect({
          onFailure: (next) => Effect.failCause(Cause.combine(cause, next)),
          onSuccess: () => Effect.failCause(cause),
        }),
      )
    }),
  )
})

const plan = Effect.fn("KiloSessionRevert.plan")(function* (
  store: SessionStore.Interface,
  input: { sessionID: Session.ID; messageID: SessionMessage.ID },
) {
  const boundary = yield* store.messageWithRefs(input.messageID)
  if (!boundary || boundary.sessionID !== input.sessionID) {
    return yield* new Session.MessageNotFoundError(input)
  }
  const after = yield* store
    .messagesWithRefs({
      sessionID: input.sessionID,
      order: "asc",
      type: "assistant",
      cursor: { id: input.messageID, direction: "next" },
    })
    .pipe(Effect.orDie)
  const steps = boundary.message.type === "assistant" ? [boundary.message, ...after] : after
  const files = new Map<RelativePath, Snapshot.ID>()
  for (const message of steps) {
    if (message.type !== "assistant" || !message.snapshot?.start) continue
    for (const file of message.snapshot.files ?? []) {
      if (!files.has(file)) files.set(file, message.snapshot.start)
    }
  }
  return files
})

// kilo_port(session-revert:d9192fbbb4a5)
export const layer = Layer.effect(
  Session.Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const store = yield* SessionStore.Service
    const instances = yield* Instance.Service
    const bus = yield* Bus.Service

    const stage: Session.Interface["revert"]["stage"] = Effect.fn("KiloSessionRevert.stage")(function* (input) {
      const session = yield* sessions.get(input.sessionID)
      if ((yield* sessions.active).has(input.sessionID)) {
        return yield* new Session.BusyError({ sessionID: input.sessionID })
      }
      const next = yield* plan(store, { sessionID: input.sessionID, messageID: input.messageID })

      return yield* Effect.gen(function* () {
        const location = yield* Location.Service
        const config = yield* Config.Service
        const snapshot = yield* Snapshot.Service
        const loaded = yield* config.entries()
        const git = location.vcs?.type === "git"
        const snapshotsEnabled = Config.latest(loaded, "snapshots") !== false
        const canRestore = input.files !== false && git && snapshotsEnabled
        const workspace = !git
          ? ("not-a-git-repo" as const)
          : !snapshotsEnabled
            ? ("snapshots-disabled" as const)
            : canRestore && next.size > 0
              ? ("restored" as const)
              : ("unavailable" as const)

        const targets = new Map<RelativePath, Snapshot.ID>()
        if (git && snapshotsEnabled && session.revert?.snapshot) {
          for (const file of session.revert.files ?? []) {
            targets.set(RelativePath.make(file.file), session.revert.snapshot)
          }
        }
        if (canRestore) {
          for (const [file, tree] of next) targets.set(file, tree)
        }

        const fresh = git && snapshotsEnabled ? yield* snapshot.capture() : undefined
        const original = session.revert?.snapshot ?? fresh
        const baseline = session.revert?.snapshot && targets.size > 0 ? fresh : original
        if (targets.size > 0 && !baseline) {
          return yield* new Snapshot.Error({
            operation: "capture",
            message: "Cannot rewind files because the current workspace snapshot is unavailable",
          })
        }

        return yield* apply(
          snapshot,
          baseline,
          Array.from(targets.keys()),
          Effect.gen(function* () {
            if (targets.size > 0) yield* snapshot.restore({ files: targets })
            const paths = canRestore ? Array.from(next.keys()) : []
            const files =
              original && paths.length > 0
                ? yield* snapshot.diff({ from: original, to: (yield* snapshot.capture()) ?? original, paths })
                : []
            const revert = {
              messageID: input.messageID,
              snapshot: original,
              files,
              workspace,
            } satisfies NonNullable<Session.Info["revert"]>
            yield* bus.publish(SessionEvent.RevertEvent.Staged, {
              sessionID: session.id,
              revert,
            })
            return revert
          }),
        )
      }).pipe(instances.provide(session))
    })

    const clear: Session.Interface["revert"]["clear"] = Effect.fn("KiloSessionRevert.clear")(function* (sessionID) {
      const session = yield* sessions.get(sessionID)
      if ((yield* sessions.active).has(sessionID)) return yield* new Session.BusyError({ sessionID })
      if (!session.revert) return
      const prior = (session.revert.files ?? []).map((file) => RelativePath.make(file.file))
      if (!session.revert.snapshot || prior.length === 0) return yield* sessions.revert.clear(sessionID)

      yield* Effect.gen(function* () {
        const location = yield* Location.Service
        const config = yield* Config.Service
        const snapshot = yield* Snapshot.Service
        const loaded = yield* config.entries()
        const enabled = location.vcs?.type === "git" && Config.latest(loaded, "snapshots") !== false
        if (!enabled) return yield* new Snapshot.Error({ operation: "restore", message: "Snapshots are disabled" })
        const baseline = yield* snapshot.capture()
        if (!baseline) {
          return yield* new Snapshot.Error({
            operation: "capture",
            message: "Cannot restore files because the current workspace snapshot is unavailable",
          })
        }
        yield* apply(snapshot, baseline, prior, sessions.revert.clear(sessionID))
      }).pipe(instances.provide(session))
    })

    // A whole-session fork copies the visible conversation: with a staged revert it stops at the boundary instead of
    // carrying the hidden turns into the copy. This covers tab forks, Agent Manager forks and Continue in worktree.
    const fork: Session.Interface["fork"] = Effect.fn("KiloSessionRevert.fork")(function* (input) {
      if (input.before) return yield* sessions.fork(input)
      const session = yield* sessions.get(input.sessionID)
      if (!session.revert) return yield* sessions.fork(input)
      return yield* sessions.fork({ ...input, before: session.revert.messageID })
    })

    return Session.Service.of({
      ...sessions,
      fork,
      revert: {
        ...sessions.revert,
        stage,
        clear,
      },
    })
  }),
)

const base = Session.node.mapLayer((value) => value)
export const node = makeGlobalNode({
  service: Session.Service,
  layer,
  deps: [base, Bus.node, Instance.node, SessionStore.node],
})
