import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as SandboxPolicy from "@/kilocode/sandbox/policy"
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
  it.live("clears every directory override when removing outside instance context", () =>
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
      expect((yield* provideInstance(dir)(SandboxPolicy.status(info.id))).enabled).toBe(true)
      expect((yield* provideInstance(worktree)(SandboxPolicy.status(info.id))).enabled).toBe(true)
      yield* session.remove(info.id)
      expect((yield* provideInstance(dir)(SandboxPolicy.status(info.id))).enabled).toBe(false)
      expect((yield* provideInstance(worktree)(SandboxPolicy.status(info.id))).enabled).toBe(false)
    }),
  )
})
