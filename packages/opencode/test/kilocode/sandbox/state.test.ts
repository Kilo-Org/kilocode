import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { enabled as sandboxed } from "@kilocode/sandbox"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import * as Network from "@/kilocode/sandbox/network"
import * as SandboxPolicy from "@/kilocode/sandbox/policy"
import { SessionID } from "@/session/schema"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.mergeAll(Bus.layer, Config.defaultLayer, CrossSpawnSpawner.defaultLayer))
const tool = Network.builtin({ id: "read" })

function execute<A, E, R>(sessionID: SessionID, effect: Effect.Effect<A, E, R>) {
  return SandboxPolicy.executeTool(sessionID, tool, effect)
}

it.instance(
  "uses config as the default without persisting session toggles",
  () =>
    Effect.gen(function* () {
      const id = SessionID.make("ses_sandbox_config")
      const initial = yield* SandboxPolicy.status(id)
      expect(initial.enabled).toBe(initial.available)
      expect(initial.version).toBe(0)
      if (!initial.available) return

      const disabled = yield* SandboxPolicy.toggle(id)
      expect(disabled.enabled).toBe(false)
      expect(disabled.version).toBe(1)
      expect((yield* (yield* Config.Service).get()).experimental?.sandbox).toBe(true)

      yield* SandboxPolicy.clear(id)
      expect((yield* SandboxPolicy.status(id)).enabled).toBe(true)
    }),
  { config: { experimental: { sandbox: true } } },
)

it.instance("runs unrestricted when config is off and no override exists", () =>
  Effect.gen(function* () {
    const id = SessionID.make("ses_sandbox_default_off")
    expect((yield* SandboxPolicy.status(id)).enabled).toBe(false)
    expect(yield* execute(id, sandboxed)).toBe(false)
  }),
)

it.instance(
  "runs sandboxed when config is on and no override exists",
  () =>
    Effect.gen(function* () {
      const id = SessionID.make("ses_sandbox_default_on")
      const status = yield* SandboxPolicy.status(id)
      expect(status.enabled).toBe(status.available)
      expect(yield* execute(id, sandboxed)).toBe(status.available)
    }),
  { config: { experimental: { sandbox: true } } },
)

it.instance(
  "overrides config off for only one session",
  () =>
    Effect.gen(function* () {
      const first = SessionID.make("ses_sandbox_override_off")
      const second = SessionID.make("ses_sandbox_config_stays_on")
      if (!(yield* SandboxPolicy.status(first)).available) return

      expect((yield* SandboxPolicy.toggle(first)).enabled).toBe(false)
      expect(yield* execute(first, sandboxed)).toBe(false)
      expect(yield* execute(second, sandboxed)).toBe(true)
    }),
  { config: { experimental: { sandbox: true } } },
)

it.instance("overrides config off to sandbox only one session", () =>
  Effect.gen(function* () {
    const first = SessionID.make("ses_sandbox_override_on")
    const second = SessionID.make("ses_sandbox_default_remains_off")
    if (!(yield* SandboxPolicy.status(first)).available) return

    expect((yield* SandboxPolicy.toggle(first)).enabled).toBe(true)
    expect(yield* execute(first, sandboxed)).toBe(true)
    expect(yield* execute(second, sandboxed)).toBe(false)
  }),
)

it.instance("isolates concurrent session overrides and clears them", () =>
  Effect.gen(function* () {
    const first = SessionID.make("ses_sandbox_first")
    const second = SessionID.make("ses_sandbox_second")
    const support = yield* SandboxPolicy.status(first)
    if (!support.available) {
      expect((yield* SandboxPolicy.toggle(first)).enabled).toBe(false)
      return
    }

    expect((yield* SandboxPolicy.toggle(first)).enabled).toBe(true)
    expect((yield* SandboxPolicy.status(second)).enabled).toBe(false)
    expect((yield* SandboxPolicy.toggle(second)).enabled).toBe(true)
    expect((yield* SandboxPolicy.toggle(second)).enabled).toBe(false)
    expect((yield* SandboxPolicy.status(first)).enabled).toBe(true)
    yield* SandboxPolicy.clear(first)
    expect((yield* SandboxPolicy.status(first)).enabled).toBe(false)
    expect((yield* SandboxPolicy.status(second)).enabled).toBe(false)
  }),
)

it.instance("does not activate an unavailable backend", () =>
  Effect.gen(function* () {
    const id = SessionID.make("ses_sandbox_support")
    const result = yield* SandboxPolicy.toggle(id)
    if (result.available) return
    expect(result.enabled).toBe(false)
    expect(result.reason?.length).toBeGreaterThan(0)
  }),
)

it.instance("serializes concurrent toggles for a session", () =>
  Effect.gen(function* () {
    const id = SessionID.make("ses_sandbox_concurrent")
    if (!(yield* SandboxPolicy.status(id)).available) return
    yield* Effect.all([SandboxPolicy.toggle(id), SandboxPolicy.toggle(id)], { concurrency: "unbounded" })
    expect((yield* SandboxPolicy.status(id)).enabled).toBe(false)
  }),
)

it.instance("prevents a queued toggle from restoring a retired override", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const id = SessionID.make("ses_sandbox_retire_race")
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const removal = yield* SandboxPolicy.retire(
      id,
      test.directory,
      Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined)
        yield* Deferred.await(release)
      }),
    ).pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const pending = yield* SandboxPolicy.toggleGuarded(id, Effect.fail("deleted")).pipe(Effect.exit, Effect.forkChild)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(removal)
    expect(Exit.isFailure(yield* Fiber.join(pending))).toBe(true)
    expect((yield* SandboxPolicy.status(id)).enabled).toBe(false)
  }),
)

it.instance("uses nested session state instead of inheriting a parent profile", () =>
  Effect.gen(function* () {
    const parent = SessionID.make("ses_sandbox_parent")
    const child = SessionID.make("ses_sandbox_child")
    if (!(yield* SandboxPolicy.status(parent)).available) return
    yield* SandboxPolicy.toggle(parent)
    expect(yield* execute(parent, execute(child, sandboxed))).toBe(false)
    expect(yield* execute(child, execute(parent, sandboxed))).toBe(true)
  }),
)

it.instance("enforces writes only while the macOS session override is active", () =>
  Effect.gen(function* () {
    if (process.platform !== "darwin") return
    const test = yield* TestInstance
    const id = SessionID.make("ses_sandbox_process")
    if (!(yield* SandboxPolicy.status(id)).available) return
    const outside = path.join(path.dirname(test.directory), `outside-${path.basename(test.directory)}`)
    const inside = path.join(test.directory, "allowed.txt")
    const git = path.join(test.directory, ".git", "denied.txt")
    const external = path.join(outside, "denied.txt")
    yield* Effect.promise(() => fs.mkdir(path.dirname(git), { recursive: true }))
    yield* Effect.promise(() => fs.mkdir(outside, { recursive: true }))
    yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(outside, { recursive: true, force: true })))
    const run = (file: string) =>
      ChildProcessSpawner.ChildProcessSpawner.use((svc) =>
        svc.spawn(ChildProcess.make("/usr/bin/touch", [file])).pipe(Effect.flatMap((child) => child.exitCode)),
      )

    expect((yield* SandboxPolicy.toggle(id)).enabled).toBe(true)
    expect(Number(yield* execute(id, run(inside)))).toBe(0)
    expect(Number(yield* execute(id, run(external)))).not.toBe(0)
    expect(Number(yield* execute(id, run(git)))).not.toBe(0)
    expect((yield* SandboxPolicy.toggle(id)).enabled).toBe(false)
    expect(Number(yield* execute(id, run(external)))).toBe(0)
  }),
)
