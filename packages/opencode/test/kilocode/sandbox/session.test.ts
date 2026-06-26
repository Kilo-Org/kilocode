import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Flag } from "@opencode-ai/core/flag/flag"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as SandboxPolicy from "@/kilocode/sandbox/policy"
import * as SandboxState from "@/kilocode/sandbox/state"
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

function authenticated<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const password = Flag.KILO_SERVER_PASSWORD
      Flag.KILO_SERVER_PASSWORD = "sandbox-test"
      return password
    }),
    () => effect,
    (password) => Effect.sync(() => (Flag.KILO_SERVER_PASSWORD = password)),
  )
}

describe("sandbox session state", () => {
  it.live("forks inherit the source session snapshot", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const dir = yield* tmpdirScoped({ git: true, config: { experimental: { sandbox: true } } })
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

  it.live("uses one persisted snapshot across request directories", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const dir = yield* tmpdirScoped({ git: true })
      const worktree = yield* tmpdirScoped({ git: true })
      const info = yield* provideInstance(dir)(session.create({ title: "sandbox-scope" }))
      const support = yield* provideInstance(dir)(SandboxPolicy.status(info.id))
      if (!support.available) {
        yield* session.remove(info.id)
        return
      }

      yield* provideInstance(dir)(SandboxPolicy.toggle(info.id))
      expect((yield* provideInstance(worktree)(SandboxPolicy.status(info.id))).enabled).toBe(false)
      expect((yield* Effect.promise(() => SandboxStore.read(dir, info.id)))?.enabled).toBe(false)
      expect((yield* Effect.promise(() => SandboxStore.read(worktree, info.id)))?.enabled).toBe(false)

      yield* provideInstance(worktree)(SandboxPolicy.toggle(info.id))
      expect((yield* provideInstance(dir)(SandboxPolicy.status(info.id))).enabled).toBe(true)
      yield* session.remove(info.id)
      expect(yield* Effect.promise(() => SandboxStore.read(dir, info.id))).toBeUndefined()
      expect(yield* Effect.promise(() => SandboxStore.read(worktree, info.id))).toBeUndefined()
    }),
  )

  it.live("seeds the secure snapshot from new-session metadata", () =>
    authenticated(
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const off = yield* tmpdirScoped({ git: true, config: { experimental: { sandbox: false } } })
        const on = yield* tmpdirScoped({ git: true, config: { experimental: { sandbox: true } } })
        const enabled = yield* provideInstance(off)(
          sessions.create({
            title: "sandbox-enabled-seed",
            metadata: SandboxState.merge(undefined, { enabled: true, version: 4 }),
          }),
        )
        const disabled = yield* provideInstance(on)(
          sessions.create({
            title: "sandbox-disabled-seed",
            metadata: SandboxState.merge(undefined, { enabled: false, version: 6 }),
          }),
        )
        const enabledStatus = yield* provideInstance(off)(SandboxPolicy.status(enabled.id))
        const disabledStatus = yield* provideInstance(on)(SandboxPolicy.status(disabled.id))
        expect(enabledStatus.enabled).toBe(enabledStatus.available)
        expect(disabledStatus.enabled).toBe(false)
        expect(yield* Effect.promise(() => SandboxStore.read(off, enabled.id))).toEqual({
          enabled: true,
          mode: "deny",
          version: 4,
        })
        expect(yield* Effect.promise(() => SandboxStore.read(on, disabled.id))).toEqual({
          enabled: false,
          mode: "deny",
          version: 6,
        })

        yield* sessions.remove(enabled.id)
        yield* sessions.remove(disabled.id)
      }),
    ),
  )

  it.live("uses new-session metadata when toggled before status loads", () =>
    authenticated(
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const dir = yield* tmpdirScoped({ git: true, config: { experimental: { sandbox: false } } })
        const info = yield* provideInstance(dir)(
          sessions.create({
            title: "sandbox-toggle-seed",
            metadata: SandboxState.merge(undefined, { enabled: true, version: 4 }),
          }),
        )

        expect(yield* provideInstance(dir)(SandboxPolicy.toggle(info.id))).toMatchObject({ enabled: false, version: 5 })
        expect(yield* Effect.promise(() => SandboxStore.read(dir, info.id))).toEqual({
          enabled: false,
          mode: "deny",
          version: 5,
        })
        yield* sessions.remove(info.id)
      }),
    ),
  )

  it.live("mirrors trusted toggles into session metadata", () =>
    authenticated(
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const dir = yield* tmpdirScoped({ git: true, config: { experimental: { sandbox: true } } })
        const info = yield* provideInstance(dir)(sessions.create({ title: "sandbox-toggle-metadata" }))
        yield* provideInstance(dir)(SandboxPolicy.status(info.id))
        yield* provideInstance(dir)(SandboxPolicy.toggle(info.id))

        expect(SandboxState.parse((yield* sessions.get(info.id)).metadata)).toEqual({ enabled: false, version: 1 })
        yield* sessions.remove(info.id)
      }),
    ),
  )
})
