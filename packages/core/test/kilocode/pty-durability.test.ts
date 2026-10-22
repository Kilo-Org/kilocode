import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Queue } from "effect"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap, buildLocationServiceMap } from "@opencode-ai/core/location-services"
import { Pty } from "@opencode-ai/core/pty"
import type { PtyID } from "@opencode-ai/core/pty/schema"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import * as Registry from "../../src/kilocode/pty/registry"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ApplicationTools.node, Database.node, EventV2.node, LocationServiceMap.node]), [
    [LocationServiceMap.node, buildLocationServiceMap([], { idleTimeToLive: "50 millis" })],
  ]),
)

const live = process.platform === "win32" ? it.live.skip : it.live

function ref(directory: string, workspaceID?: WorkspaceV2.ID) {
  return Location.Ref.make({ directory: AbsolutePath.make(directory), workspaceID })
}

function alive(pid: number) {
  return Effect.sync(() => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      void error
      return false
    }
  })
}

describe("durable PTY registry", () => {
  live("waits for in-flight creates before server shutdown", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => Pty.shutdown())
      const target = ref("/tmp/pty-shutdown-gate")
      const release = Registry.beginCreate(target)
      let finished = false
      const task = Registry.shutdown().then(() => {
        finished = true
      })

      yield* Effect.sleep("25 millis")
      expect(finished).toBe(false)
      release()
      yield* Effect.promise(() => task)
      expect(finished).toBe(true)
    }),
  )

  live("blocks new creates while a worktree is being removed", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => Pty.shutdown())
      const target = ref("/tmp/pty-directory-gate")
      const release = Registry.beginCreate(target)
      const task = Registry.terminateDirectory(target)
      yield* Effect.sleep("25 millis")
      expect(() => Registry.beginCreate(target)).toThrow("PTY directory is being removed")
      release()
      yield* Effect.promise(() => task)
    }),
  )

  live("retains the same PTY across location disposal and idle eviction", () =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => Pty.shutdown()))
      const locations = yield* LocationServiceMap.Service
      const dir = yield* Effect.promise(() => tmpdir())
      yield* Effect.addFinalizer(() => Effect.promise(() => dir[Symbol.asyncDispose]()))
      const target = ref(dir.path)

      const info = yield* Effect.scoped(
        Effect.gen(function* () {
          const pty = yield* Pty.Service
          return yield* pty.create({ command: "/bin/sh", args: ["-c", "sleep 30"], cwd: dir.path })
        }).pipe(Effect.provide(locations.get(target))),
      )

      const beforeIdle = yield* Effect.scoped(
        Effect.gen(function* () {
          const pty = yield* Pty.Service
          return yield* pty.get(info.id)
        }).pipe(Effect.provide(locations.get(target))),
      )
      expect(beforeIdle).toMatchObject({ id: info.id, pid: info.pid, status: "running" })

      yield* Effect.sleep("200 millis")

      const afterIdle = yield* Effect.scoped(
        Effect.gen(function* () {
          const pty = yield* Pty.Service
          return yield* pty.get(info.id)
        }).pipe(Effect.provide(locations.get(target))),
      )
      expect(afterIdle).toMatchObject({ id: info.id, pid: info.pid, status: "running" })
      expect(yield* alive(info.pid)).toBe(true)

      yield* Effect.scoped(
        Effect.gen(function* () {
          const pty = yield* Pty.Service
          yield* pty.remove(info.id)
        }).pipe(Effect.provide(locations.get(target))),
      )
      expect(yield* alive(info.pid)).toBe(false)
    }),
  )

  live("isolates PTYs by directory and workspace", () =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => Pty.shutdown()))
      const locations = yield* LocationServiceMap.Service
      const dirs = yield* Effect.promise(() => Promise.all([tmpdir(), tmpdir()]))
      yield* Effect.addFinalizer(() => Effect.promise(() => Promise.all(dirs.map((dir) => dir[Symbol.asyncDispose]()))))
      const a = ref(dirs[0].path, WorkspaceV2.ID.make("wrk-a"))
      const b = ref(dirs[1].path, WorkspaceV2.ID.make("wrk-b"))
      const other = ref(dirs[0].path, WorkspaceV2.ID.make("wrk-other"))

      const create = (target: Location.Ref) =>
        Effect.scoped(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            return yield* pty.create({ command: "/bin/sh", args: ["-c", "sleep 30"], cwd: target.directory })
          }).pipe(Effect.provide(locations.get(target))),
        )
      const first = yield* create(a)
      const second = yield* create(b)
      const third = yield* create(other)

      const list = (target: Location.Ref) =>
        Effect.scoped(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            return yield* pty.list()
          }).pipe(Effect.provide(locations.get(target))),
        )
      expect((yield* list(a)).map((item) => item.id)).toEqual([first.id])
      expect((yield* list(b)).map((item) => item.id)).toEqual([second.id])
      expect((yield* list(other)).map((item) => item.id)).toEqual([third.id])

      const crossed = yield* Effect.scoped(
        Effect.gen(function* () {
          const pty = yield* Pty.Service
          return yield* pty.get(third.id).pipe(Effect.exit)
        }).pipe(Effect.provide(locations.get(a))),
      )
      expect(Exit.isFailure(crossed)).toBe(true)
      if (Exit.isFailure(crossed)) expect(Cause.squash(crossed.cause)).toMatchObject({ ptyID: third.id })
    }),
  )

  live("attributes natural exit events to the owning location after disposal", () =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => Pty.shutdown()))
      const locations = yield* LocationServiceMap.Service
      const events = yield* EventV2.Service
      const dir = yield* Effect.promise(() => tmpdir())
      yield* Effect.addFinalizer(() => Effect.promise(() => dir[Symbol.asyncDispose]()))
      const target = ref(dir.path, WorkspaceV2.ID.make("wrk-exit"))
      const queue = yield* Queue.unbounded<{ id: PtyID; location?: Location.Ref }>()
      const unsubscribe = yield* events.listen((event) => {
        const location = event.location
        if (
          event.type === Pty.Event.Exited.type &&
          location?.directory === target.directory &&
          location.workspaceID === target.workspaceID
        ) {
          Queue.offerUnsafe(queue, { id: (event.data as { id: PtyID }).id, location })
        }
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)

      const info = yield* Effect.scoped(
        Effect.gen(function* () {
          const pty = yield* Pty.Service
          return yield* pty.create({ command: "/bin/sh", args: ["-c", "exit 7"], cwd: dir.path })
        }).pipe(Effect.provide(locations.get(target))),
      )
      const exited = yield* Queue.take(queue).pipe(Effect.timeout("5 seconds"))
      expect(exited).toEqual({ id: info.id, location: target })
    }),
  )

  live("cleans up process trees for directory removal and server shutdown", () =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => Pty.shutdown()))
      const locations = yield* LocationServiceMap.Service
      const dir = yield* Effect.promise(() => tmpdir())
      yield* Effect.addFinalizer(() => Effect.promise(() => dir[Symbol.asyncDispose]()))
      const target = ref(dir.path)
      const create = () =>
        Effect.scoped(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            return yield* pty.create({ command: "/bin/sh", args: ["-c", "sleep 30"], cwd: dir.path })
          }).pipe(Effect.provide(locations.get(target))),
        )

      const removed = yield* create()
      yield* Effect.scoped(
        Effect.gen(function* () {
          const pty = yield* Pty.Service
          yield* pty.removeDirectory(target)
        }).pipe(Effect.provide(locations.get(target))),
      )
      expect(yield* alive(removed.pid)).toBe(false)

      const shutdown = yield* create()
      yield* Effect.promise(() => Pty.shutdown())
      expect(yield* alive(shutdown.pid)).toBe(false)
      const remaining = yield* Effect.scoped(
        Effect.gen(function* () {
          const pty = yield* Pty.Service
          return yield* pty.list()
        }).pipe(Effect.provide(locations.get(target))),
      )
      expect(remaining).toEqual([])
    }),
  )
})
