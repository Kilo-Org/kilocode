import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Database } from "@opencode-ai/core/database/database"
import { assertNetwork, enabled as sandboxed } from "@kilocode/sandbox"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import * as Network from "@/kilocode/sandbox/network"
import * as SandboxPolicy from "@/kilocode/sandbox/policy"
import { SandboxStore } from "@/kilocode/sandbox/store"
import { SessionID } from "@/session/schema"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(
  Layer.mergeAll(Bus.layer, Config.defaultLayer, CrossSpawnSpawner.defaultLayer, Database.defaultLayer),
)
const linux = process.platform === "linux" ? test : test.skip
const posix = process.platform === "win32" ? test.skip : test
const tool = Network.builtin({ id: "read" })

function execute<A, E, R>(sessionID: SessionID, effect: Effect.Effect<A, E, R>) {
  return SandboxPolicy.executeTool(sessionID, tool, effect)
}

test("restores the session snapshot after a backend restart", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-sandbox-restart-"))
  const directory = path.join(root, "project")
  await fs.mkdir(directory)
  const script = [
    'import { Effect, Layer } from "effect"',
    'import { Config } from "@/config/config"',
    'import { Database } from "@opencode-ai/core/database/database"',
    'import { InstanceRef } from "@/effect/instance-ref"',
    'import * as SandboxPolicy from "@/kilocode/sandbox/policy"',
    'import { SandboxStore } from "@/kilocode/sandbox/store"',
    'import { SessionID } from "@/session/schema"',
    "const directory = process.env.TEST_DIRECTORY",
    'const context = { directory, worktree: directory, project: { id: "sandbox-restart", worktree: directory, vcs: "git", time: { created: 0, updated: 0 }, sandboxes: [] } }',
    "const cfg = JSON.parse(process.env.TEST_CONFIG)",
    'const id = SessionID.make("ses_sandbox_restart")',
    "const status = await SandboxPolicy.status(id).pipe(Effect.provide(Layer.mock(Config.Service, { get: () => Effect.succeed(cfg) })), Effect.provide(Database.defaultLayer), Effect.provideService(InstanceRef, context), Effect.runPromise)",
    "const state = await SandboxStore.read(directory, id)",
    "console.log(JSON.stringify({ status, state }))",
  ].join("\n")
  const env = {
    ...process.env,
    KILO_TEST_HOME: path.join(root, "home"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
    TEST_DIRECTORY: directory,
  }
  const run = (config: object) => {
    const result = Bun.spawnSync([process.execPath, "-e", script], {
      cwd: import.meta.dir,
      env: { ...env, TEST_CONFIG: JSON.stringify(config) },
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    return JSON.parse(result.stdout.toString().trim().split("\n").at(-1)!) as {
      status: { enabled: boolean; available: boolean; version: number }
      state: { enabled: boolean; mode: string; version: number }
    }
  }

  try {
    const initial = run({ experimental: { sandbox: true, sandbox_restrict_network: true } })
    expect(initial.state).toEqual({ enabled: true, mode: "deny", version: 0 })
    const restored = run({ experimental: { sandbox: false, sandbox_restrict_network: false } })
    expect(restored.state).toEqual(initial.state)
    expect(restored.status.enabled).toBe(restored.status.available)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

posix("canonicalizes a symlinked policy state root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-sandbox-state-link-"))
  const target = path.join(root, "real-state")
  const link = path.join(root, "state")
  await fs.mkdir(target)
  await fs.symlink(target, link)
  const script = 'import { SandboxStore } from "@/kilocode/sandbox/store"; console.log(SandboxStore.root)'

  try {
    const result = Bun.spawnSync([process.execPath, "-e", script], {
      cwd: import.meta.dir,
      env: { ...process.env, XDG_STATE_HOME: link },
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(result.stdout.toString().trim().split("\n").at(-1)).toBe(
      path.join(await fs.realpath(target), "kilo-sandbox-policy"),
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

linux("reports configured network namespace availability", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "kilo-sandbox-status-"))
  const helper = path.join(root, "bwrap-no-network")
  await fs.writeFile(
    helper,
    [
      "#!/bin/sh",
      'for arg in "$@"; do',
      '  if [ "$arg" = "--unshare-net" ]; then echo "network namespaces blocked" >&2; exit 42; fi',
      "done",
      "exit 0",
      "",
    ].join("\n"),
  )
  await fs.chmod(helper, 0o755)
  const script = [
    'import { Effect, Layer } from "effect"',
    'import { Config } from "@/config/config"',
    'import { InstanceRef } from "@/effect/instance-ref"',
    'import * as SandboxPolicy from "@/kilocode/sandbox/policy"',
    'import { SessionID } from "@/session/schema"',
    "const directory = process.cwd()",
    'const context = { directory, worktree: directory, project: { id: "sandbox-status", worktree: directory, vcs: "git", time: { created: 0, updated: 0 }, sandboxes: [] } }',
    "const status = (restrict) => SandboxPolicy.status(SessionID.make(`ses_sandbox_status_${restrict}`)).pipe(Effect.provide(Layer.mock(Config.Service, { get: () => Effect.succeed({ experimental: { sandbox: true, sandbox_restrict_network: restrict } }) })), Effect.provideService(InstanceRef, context), Effect.runPromise)",
    "const deny = await status(true)",
    "const allow = await status(false)",
    'if (deny.available || deny.enabled || !deny.reason?.includes("Linux network sandbox")) process.exit(2)',
    "if (!allow.available || !allow.enabled) process.exit(3)",
  ].join("\n")

  try {
    const result = Bun.spawnSync([process.execPath, "-e", script], {
      cwd: import.meta.dir,
      env: { ...process.env, KILO_BWRAP_PATH: helper, KILO_SERVER_PASSWORD: "sandbox-test" },
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

it.instance("snapshots the primary kilo config for the session lifetime", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const password = Flag.KILO_SERVER_PASSWORD
      Flag.KILO_SERVER_PASSWORD = "sandbox-test"
      return password
    }),
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const file = path.join(test.directory, "kilo.json")
        const legacy = path.join(test.directory, "opencode.json")
        const config = yield* Config.Service
        yield* Effect.promise(() =>
          Bun.write(file, JSON.stringify({ experimental: { sandbox: true, sandbox_restrict_network: true } })),
        )
        yield* config.update({ experimental: { sandbox: true, sandbox_restrict_network: true } })

        const id = SessionID.make("ses_sandbox_config")
        const initial = yield* SandboxPolicy.status(id)
        expect(initial.enabled).toBe(initial.available)
        expect(initial.version).toBe(0)
        if (!initial.available) return

        yield* Effect.promise(() =>
          Bun.write(file, JSON.stringify({ experimental: { sandbox: false, sandbox_restrict_network: false } })),
        )
        yield* config.update({ experimental: { sandbox: false, sandbox_restrict_network: false } })

        expect((yield* config.get()).experimental?.sandbox).toBe(false)
        expect(yield* Effect.promise(() => Bun.file(legacy).exists())).toBe(false)
        expect((yield* SandboxPolicy.status(id)).enabled).toBe(true)
        expect(yield* execute(id, sandboxed)).toBe(true)
        expect(Exit.isFailure(yield* execute(id, assertNetwork("https://example.com").pipe(Effect.exit)))).toBe(true)

        const next = SessionID.make("ses_sandbox_config_next")
        expect((yield* SandboxPolicy.status(next)).enabled).toBe(false)
        expect(yield* execute(next, sandboxed)).toBe(false)
      }),
    (password) => Effect.sync(() => (Flag.KILO_SERVER_PASSWORD = password)),
  ),
)

it.instance("does not enable authless sessions without the experimental sandbox flag", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const password = Flag.KILO_SERVER_PASSWORD
      Flag.KILO_SERVER_PASSWORD = undefined
      return password
    }),
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const id = SessionID.make("ses_sandbox_default_off")
        const status = yield* SandboxPolicy.status(id)
        const state = yield* Effect.promise(() => SandboxStore.read(test.directory, id))

        expect(state?.enabled).toBe(false)
        expect(state?.mode).toBe("deny")
        expect(state?.version).toBe(0)
        expect(status.enabled).toBe(false)
        expect(yield* execute(id, sandboxed)).toBe(false)
      }),
    (password) => Effect.sync(() => (Flag.KILO_SERVER_PASSWORD = password)),
  ),
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
  "persists a toggle so new sessions inherit the last choice",
  () =>
    Effect.gen(function* () {
      const first = SessionID.make("ses_sandbox_persist_off")
      const second = SessionID.make("ses_sandbox_persist_inherit")
      if (!(yield* SandboxPolicy.status(first)).available) return

      expect((yield* SandboxPolicy.toggle(first)).enabled).toBe(false)
      expect(yield* execute(first, sandboxed)).toBe(false)
      expect((yield* SandboxPolicy.status(second)).enabled).toBe(false)
      expect(yield* execute(second, sandboxed)).toBe(false)
    }),
  { config: { experimental: { sandbox: true } } },
)

it.instance("persists an authless toggle to later sessions", () =>
  Effect.gen(function* () {
    const first = SessionID.make("ses_sandbox_authless_persist")
    const second = SessionID.make("ses_sandbox_authless_inherit")
    if (!(yield* SandboxPolicy.status(first)).available) return

    expect((yield* SandboxPolicy.toggle(first)).enabled).toBe(true)
    expect(yield* execute(first, sandboxed)).toBe(true)
    expect((yield* SandboxPolicy.status(second)).enabled).toBe(true)
    expect(yield* execute(second, sandboxed)).toBe(true)
  }),
)

it.instance(
  "remembers a later toggle back on for new sessions",
  () =>
    Effect.gen(function* () {
      const first = SessionID.make("ses_sandbox_roundtrip_a")
      const second = SessionID.make("ses_sandbox_roundtrip_b")
      const third = SessionID.make("ses_sandbox_roundtrip_c")
      if (!(yield* SandboxPolicy.status(first)).available) return

      yield* SandboxPolicy.toggle(first)
      expect((yield* SandboxPolicy.status(second)).enabled).toBe(false)
      yield* SandboxPolicy.toggle(second)
      expect((yield* SandboxPolicy.status(third)).enabled).toBe(true)
      expect(yield* execute(third, sandboxed)).toBe(true)
    }),
  { config: { experimental: { sandbox: true } } },
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
    // Seed second with its own stored snapshot before any toggle, so its state
    // stays independent of the per-directory preference that toggles now persist.
    expect((yield* SandboxPolicy.status(second)).enabled).toBe(false)

    expect((yield* SandboxPolicy.toggle(first)).enabled).toBe(true)
    expect((yield* SandboxPolicy.status(second)).enabled).toBe(false)
    expect((yield* SandboxPolicy.toggle(second)).enabled).toBe(true)
    expect((yield* SandboxPolicy.toggle(second)).enabled).toBe(false)
    expect((yield* SandboxPolicy.status(first)).enabled).toBe(true)
    yield* SandboxPolicy.retire(first, (yield* TestInstance).directory, Effect.void)
    // retire clears first's stored snapshot; it re-seeds from the persisted
    // per-directory preference, which holds the last toggle (second -> false).
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
    const status = yield* SandboxPolicy.status(id)
    expect(status.enabled).toBe(false)
  }),
)

it.instance(
  "inherits a parent snapshot for delegated sessions",
  () =>
    Effect.gen(function* () {
      const parent = SessionID.make("ses_sandbox_parent")
      const child = SessionID.make("ses_sandbox_child")
      const status = yield* SandboxPolicy.status(parent)
      if (!status.available) return

      yield* SandboxPolicy.inherit(parent, child, { enabled: true, mode: "deny" })
      yield* SandboxPolicy.toggle(parent)
      expect((yield* SandboxPolicy.status(parent)).enabled).toBe(false)
      expect((yield* SandboxPolicy.status(child)).enabled).toBe(true)

      yield* SandboxPolicy.toggle(child)
      yield* SandboxPolicy.toggle(parent)
      expect((yield* SandboxPolicy.status(child)).enabled).toBe(false)
      yield* SandboxPolicy.inherit(parent, child)
      expect((yield* SandboxPolicy.status(child)).enabled).toBe(true)
      expect(yield* execute(child, sandboxed)).toBe(true)
    }),
  { config: { experimental: { sandbox: true } } },
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
