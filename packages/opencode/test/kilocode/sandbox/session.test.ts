import fs from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { SessionV2 } from "@opencode-ai/core/session"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { BackgroundProcess } from "@/kilocode/background-process"
import { Notebook } from "@/kilocode/notebook/service"
import * as SandboxActivation from "@/kilocode/sandbox/activation"
import * as SandboxInheritance from "@/kilocode/sandbox/inheritance"
import * as SandboxPolicy from "@/kilocode/sandbox/policy"
import { SandboxStore } from "@/kilocode/sandbox/store"
import type { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Shell } from "@opencode-ai/core/shell"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "@/sync"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    Session.layer.pipe(
      Layer.provide(Bus.layer),
      Layer.provide(Storage.defaultLayer),
      Layer.provide(SyncEvent.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
      Layer.provide(BackgroundJob.defaultLayer),
      Layer.provide(Database.defaultLayer),
      Layer.provide(EventV2Bridge.defaultLayer),
      Layer.provide(SessionV2.defaultLayer),
    ),
    BackgroundJob.defaultLayer,
    Bus.layer,
    Config.defaultLayer,
    Database.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    testInstanceStoreLayer,
    Notebook.defaultLayer,
    SessionStatus.defaultLayer,
  ),
)

function quote(input: string) {
  const value = input.replaceAll("\\", "/")
  if (process.platform === "win32") return `"${value.replaceAll('"', '""')}"`
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function script(dir: string) {
  const file = path.join(dir, "sandbox-parent-process.mjs")
  await Bun.write(file, `console.log("ready")\nsetInterval(() => {}, 1_000)\n`)
  const bin = quote(process.execPath)
  const arg = quote(file)
  if (Shell.ps(Shell.acceptable())) return `& ${bin} ${arg}`
  return `${bin} ${arg}`
}

function linked(root: string) {
  return Effect.gen(function* () {
    const dir = path.join(path.dirname(root), path.basename(root) + "-sandbox-worktree")
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        await $`git worktree remove --force ${dir}`.cwd(root).quiet().nothrow()
        await fs.rm(dir, { recursive: true, force: true })
      }),
    )
    yield* Effect.promise(() =>
      $`git worktree add --quiet -b sandbox-activation-${Date.now()} ${dir} HEAD`.cwd(root).quiet(),
    )
    return dir
  })
}

function activate(sessionID: Session.Info["id"]) {
  const check = (family: readonly SandboxPolicy.Target[]) =>
    Effect.gen(function* () {
      if (!(yield* SandboxActivation.idle(sessionID, family))) yield* Effect.fail("busy")
    })
  return SandboxPolicy.toggleGuarded(
    sessionID,
    (enabling, family) =>
      enabling
        ? check(family).pipe(Effect.andThen(Effect.promise(() => BackgroundProcess.stopSession(sessionID))))
        : Effect.void,
    SandboxActivation.family(sessionID),
    check,
  )
}

describe("sandbox session cleanup", () => {
  test("keeps inheritance grants valid across slow worktree setup", () => {
    const now = Date.now
    try {
      Date.now = () => 1_700_000_000_000
      const sid = "session" as SessionID
      const token = SandboxInheritance.issue({ sessionID: sid, directory: "/repo", count: 1 })
      Date.now = () => 1_700_000_000_000 + 6 * 60 * 1000
      expect(SandboxInheritance.consume(token)).toEqual({ sessionID: sid, directory: "/repo" })
    } finally {
      Date.now = now
    }
  })

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

  it.live("created sessions inherit the source snapshot across directories", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const dir = yield* tmpdirScoped({ git: true, config: { sandbox: { enabled: true } } })
      const worktree = yield* tmpdirScoped({ git: true })
      const source = yield* provideInstance(dir)(sessions.create({ title: "sandbox-source" }))
      const status = yield* provideInstance(dir)(SandboxPolicy.status(source.id))
      if (!status.available) return
      const token = SandboxInheritance.issue({ sessionID: source.id, directory: dir, count: 1 })

      const child = yield* provideInstance(worktree)(sessions.create({ title: "sandbox-child", sandboxInheritanceToken: token }))
      expect((yield* provideInstance(worktree)(SandboxPolicy.status(child.id))).enabled).toBe(true)

      yield* provideInstance(dir)(SandboxPolicy.toggle(source.id))
      expect((yield* provideInstance(dir)(SandboxPolicy.status(source.id))).enabled).toBe(false)
      expect((yield* provideInstance(worktree)(SandboxPolicy.status(child.id))).enabled).toBe(true)
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

describe("sandbox activation", () => {
  it.live("refuses activation while a background descendant is running", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const background = yield* BackgroundJob.Service
      const dir = yield* tmpdirScoped({ git: true })
      yield* provideInstance(dir)(
        Effect.gen(function* () {
          const parent = yield* sessions.create({ title: "sandbox-parent" })
          const child = yield* sessions.create({ parentID: parent.id, title: "sandbox-child" })
          const support = yield* SandboxPolicy.status(parent.id)
          if (!support.available) return
          const release = yield* Deferred.make<void>()
          yield* background.start({
            id: child.id,
            type: "task",
            metadata: { background: true, parentSessionId: parent.id, sessionId: child.id },
            run: Deferred.await(release).pipe(Effect.as("complete")),
          })

          const result = yield* activate(parent.id).pipe(Effect.exit)
          expect(Exit.isFailure(result)).toBe(true)
          expect((yield* SandboxPolicy.status(parent.id)).enabled).toBe(false)
          yield* Deferred.succeed(release, undefined)
        }),
      )
    }),
  )

  it.live("activates idle descendants without relaxing disable behavior", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const dir = yield* tmpdirScoped({ git: true })
      yield* provideInstance(dir)(
        Effect.gen(function* () {
          const parent = yield* sessions.create({ title: "sandbox-parent" })
          const child = yield* sessions.create({ parentID: parent.id, title: "sandbox-child" })
          const grandchild = yield* sessions.create({ parentID: child.id, title: "sandbox-grandchild" })
          const support = yield* SandboxPolicy.status(parent.id)
          if (!support.available) return

          expect((yield* activate(parent.id)).enabled).toBe(true)
          expect((yield* SandboxPolicy.status(child.id)).enabled).toBe(true)
          expect((yield* SandboxPolicy.status(grandchild.id)).enabled).toBe(true)

          expect((yield* activate(parent.id)).enabled).toBe(false)
          expect((yield* SandboxPolicy.status(child.id)).enabled).toBe(true)
          expect((yield* SandboxPolicy.status(grandchild.id)).enabled).toBe(true)
        }),
      )
    }),
  )

  it.live("activates an idle descendant in its linked worktree", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const root = yield* tmpdirScoped({ git: true })
      const worktree = yield* linked(root)
      const parent = yield* provideInstance(root)(sessions.create({ title: "sandbox-parent" }))
      const child = yield* provideInstance(worktree)(
        sessions.create({ parentID: parent.id, title: "sandbox-worktree-child" }),
      )
      const support = yield* provideInstance(root)(SandboxPolicy.status(parent.id))
      if (!support.available) return
      expect((yield* provideInstance(worktree)(SandboxPolicy.status(child.id))).enabled).toBe(false)

      const family = yield* provideInstance(root)(SandboxActivation.family(parent.id))
      expect(family.find((target) => target.id === child.id)?.directory).toBe(worktree)
      expect((yield* provideInstance(root)(activate(parent.id))).enabled).toBe(true)
      expect((yield* Effect.promise(() => SandboxStore.read(worktree, child.id)))?.enabled).toBe(true)
      expect(yield* Effect.promise(() => SandboxStore.read(root, child.id))).toBeUndefined()
    }),
  )

  it.live("rejects linked-worktree jobs and parent-lifetime processes", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const background = yield* BackgroundJob.Service
      const root = yield* tmpdirScoped({ git: true })
      const worktree = yield* linked(root)
      const parent = yield* provideInstance(root)(sessions.create({ title: "sandbox-parent" }))
      const child = yield* provideInstance(worktree)(
        sessions.create({ parentID: parent.id, title: "sandbox-worktree-child" }),
      )
      const support = yield* provideInstance(root)(SandboxPolicy.status(parent.id))
      if (!support.available) return
      const release = yield* Deferred.make<void>()
      yield* provideInstance(worktree)(
        background.start({
          id: child.id,
          type: "task",
          metadata: { background: true, parentSessionId: parent.id, sessionId: child.id },
          run: Deferred.await(release).pipe(Effect.as("complete")),
        }),
      )
      expect(Exit.isFailure(yield* provideInstance(root)(activate(parent.id).pipe(Effect.exit)))).toBe(true)
      yield* Deferred.succeed(release, undefined)
      yield* provideInstance(worktree)(background.wait({ id: child.id }))

      const command = yield* Effect.promise(() => script(worktree))
      const process = yield* provideInstance(worktree)(
        Effect.promise(() =>
          BackgroundProcess.start({
            sessionID: child.id,
            parentID: parent.id,
            command,
            cwd: worktree,
            lifetime: "parent",
            ready: { pattern: "ready", timeout: 5_000 },
          }),
        ),
      )
      yield* Effect.addFinalizer(() =>
        provideInstance(worktree)(Effect.promise(() => BackgroundProcess.stop(process.id))).pipe(Effect.ignore),
      )

      expect(Exit.isFailure(yield* provideInstance(root)(activate(parent.id).pipe(Effect.exit)))).toBe(true)
      expect(Exit.isFailure(yield* provideInstance(worktree)(activate(child.id).pipe(Effect.exit)))).toBe(true)
      const children = yield* provideInstance(worktree)(
        Effect.promise(() => BackgroundProcess.list({ sessionID: child.id })),
      )
      const parents = yield* provideInstance(worktree)(
        Effect.promise(() => BackgroundProcess.list({ sessionID: parent.id })),
      )
      expect(children.find((item) => item.id === process.id)?.lifetime).toBe("parent")
      expect(parents).toEqual([])
    }),
  )
})
