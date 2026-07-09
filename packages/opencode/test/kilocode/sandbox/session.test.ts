import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as SandboxPolicy from "@/kilocode/sandbox/policy"
import { SandboxStore } from "@/kilocode/sandbox/store"
import { Session } from "@/session/session"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "@/sync"
import { provideInstance, tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    Session.layer.pipe(
      Layer.provide(Bus.layer),
      Layer.provide(Storage.defaultLayer),
      Layer.provide(SyncEvent.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
      Layer.provide(BackgroundJob.defaultLayer),
    ),
    Bus.layer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
  ),
)

describe("sandbox session cleanup", () => {
  it.live("forks inherit the source session snapshot", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const dir = yield* tmpdirScoped({ git: true, config: { sandbox: { enabled: true } } })
      const source = yield* provideInstance(dir)(sessions.create({ title: "sandbox-source" }))
      const status = yield* provideInstance(dir)(SandboxPolicy.status(source.id))
      if (!status.available) return

      const fork = yield* provideInstance(dir)(sessions.fork({ sessionID: source.id }))
      expect((yield* provideInstance(dir)(SandboxPolicy.status(fork.id))).enabled).toBe(true)

      yield* provideInstance(dir)(SandboxPolicy.toggle(source.id))
      expect((yield* provideInstance(dir)(SandboxPolicy.status(source.id))).enabled).toBe(false)
      expect((yield* provideInstance(dir)(SandboxPolicy.status(fork.id))).enabled).toBe(true)
    }),
  )

  it.live("forks into another directory carry the source confinement", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const dir = yield* tmpdirScoped({ git: true, config: { sandbox: { enabled: true } } })
      const worktree = yield* tmpdirScoped({ git: true })
      const source = yield* provideInstance(dir)(sessions.create({ title: "sandbox-source" }))
      const status = yield* provideInstance(dir)(SandboxPolicy.status(source.id))
      if (!status.available) return

      // Move-to-worktree forks the source into a fresh directory where no snapshot exists yet.
      const fork = yield* provideInstance(worktree)(sessions.fork({ sessionID: source.id }))
      expect((yield* provideInstance(worktree)(SandboxPolicy.status(fork.id))).enabled).toBe(true)

      // The carried-over confinement must not leak a phantom snapshot for the source in the worktree.
      expect(yield* Effect.promise(() => SandboxStore.read(worktree, source.id))).toBeUndefined()
    }),
  )

  it.live("creates honor the kilocode.sandbox metadata over the config default", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      // Config default is disabled; the create-time toggle asks for enabled.
      const dir = yield* tmpdirScoped({ git: true, config: { sandbox: { enabled: false } } })
      const session = yield* provideInstance(dir)(
        sessions.create({ title: "sandbox-explicit", metadata: { "kilocode.sandbox": { enabled: true, version: 0 } } }),
      )
      const status = yield* provideInstance(dir)(SandboxPolicy.status(session.id))
      if (!status.available) return
      expect(status.enabled).toBe(true)
    }),
  )

  it.live("clears every directory snapshot when removing outside instance context", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const dir = yield* tmpdirScoped({ git: true })
      const worktree = yield* tmpdirScoped({ git: true })
      const info = yield* provideInstance(dir)(session.create({ title: "sandbox-cleanup" }))
      const support = yield* provideInstance(dir)(SandboxPolicy.status(info.id))
      if (!support.available) {
        yield* session.remove(info.id)
        return
      }

      yield* provideInstance(dir)(SandboxPolicy.toggle(info.id))
      yield* provideInstance(worktree)(SandboxPolicy.toggle(info.id))
      expect((yield* Effect.promise(() => SandboxStore.read(dir, info.id)))?.enabled).toBe(true)
      expect((yield* Effect.promise(() => SandboxStore.read(worktree, info.id)))?.enabled).toBe(true)
      yield* session.remove(info.id)
      expect(yield* Effect.promise(() => SandboxStore.read(dir, info.id))).toBeUndefined()
      expect(yield* Effect.promise(() => SandboxStore.read(worktree, info.id))).toBeUndefined()
    }),
  )
})
