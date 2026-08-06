import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Database } from "@opencode-ai/core/database/database"
import { assertNetwork, assertWrite, enabled as sandboxed } from "@kilocode/sandbox"
import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { Config } from "@/config/config"
import * as Network from "@/kilocode/sandbox/network"
import * as SandboxPolicy from "@/kilocode/sandbox/policy"
import { SandboxStore } from "@/kilocode/sandbox/store"
import { SessionID } from "@/session/schema"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    Bus.layer,
    AppNodeBuilder.build(Config.node),
    AppNodeBuilder.build(CrossSpawnSpawner.node),
    AppNodeBuilder.build(Database.node),
  ),
)
const linux = process.platform === "linux" ? test : test.skip
const posix = process.platform === "win32" ? test.skip : test
const tool = Network.builtin({ id: "read" })

function execute<A, E, R>(sessionID: SessionID, effect: Effect.Effect<A, E, R>) {
  return SandboxPolicy.executeTool(sessionID, tool, effect)
}

test("refreshes the session snapshot after a backend restart", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-sandbox-restart-"))
  const directory = path.join(root, "project")
  await fs.mkdir(directory)
  const script = [
    'import { Effect, Layer } from "effect"',
    'import { Config } from "@/config/config"',
    'import { Database } from "@opencode-ai/core/database/database"',
    'import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"',
    'import { InstanceRef } from "@/effect/instance-ref"',
    'import * as SandboxPolicy from "@/kilocode/sandbox/policy"',
    'import { SandboxStore } from "@/kilocode/sandbox/store"',
    'import { SessionID } from "@/session/schema"',
    "const directory = process.env.TEST_DIRECTORY",
    'const context = { directory, worktree: directory, project: { id: "sandbox-restart", worktree: directory, vcs: "git", time: { created: 0, updated: 0 }, sandboxes: [] } }',
    "const cfg = JSON.parse(process.env.TEST_CONFIG)",
    'const id = SessionID.make("ses_sandbox_restart")',
    "const status = await SandboxPolicy.status(id).pipe(Effect.provide(Layer.mock(Config.Service, { get: () => Effect.succeed(cfg) })), Effect.provide(AppNodeBuilder.build(Database.node)), Effect.provideService(InstanceRef, context), Effect.runPromise)",
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
      state: { enabled: boolean; mode: string; allowedHosts: string[]; writablePaths: string[]; version: number }
    }
  }

  try {
    const initial = run({
      sandbox: {
        enabled: true,
        network: "deny",
        allowed_hosts: ["API.GITHUB.COM."],
        writable_paths: ["~/sandbox-output"],
      },
    })
    expect(initial.state).toEqual({
      enabled: true,
      mode: "proxy",
      allowedHosts: ["api.github.com:443"],
      writablePaths: [path.join(os.homedir(), "sandbox-output")],
      version: 0,
    })
    const restored = run({
      sandbox: { enabled: false, network: "deny", allowed_hosts: ["evil.example"], writable_paths: ["/tmp/evil"] },
    })
    expect(restored.state).toEqual({
      enabled: true,
      mode: "proxy",
      allowedHosts: ["evil.example:443"],
      writablePaths: ["/tmp/evil"],
      version: 1,
    })
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
    'import { Database } from "@opencode-ai/core/database/database"',
    'import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"',
    'import { InstanceRef } from "@/effect/instance-ref"',
    'import * as SandboxPolicy from "@/kilocode/sandbox/policy"',
    'import { SessionID } from "@/session/schema"',
    "const directory = process.cwd()",
    'const context = { directory, worktree: directory, project: { id: "sandbox-status", worktree: directory, vcs: "git", time: { created: 0, updated: 0 }, sandboxes: [] } }',
    "const status = (restrict) => SandboxPolicy.status(SessionID.make(`ses_sandbox_status_${restrict}`)).pipe(Effect.provide(Layer.mock(Config.Service, { get: () => Effect.succeed({ sandbox: { enabled: true, network: restrict ? 'deny' : 'allow' } }) })), Effect.provide(AppNodeBuilder.build(Database.node)), Effect.provideService(InstanceRef, context), Effect.runPromise)",
    "const deny = await status(true)",
    "const allow = await status(false)",
    'if (deny.available || deny.enabled || !deny.reason?.includes("Linux network sandbox")) process.exit(2)',
    "if (!allow.available || !allow.enabled) process.exit(3)",
    'const blocked = await SandboxPolicy.executeTool(SessionID.make("ses_sandbox_status_true"), { id: "read" }, Effect.succeed("escaped")).pipe(Effect.provide(Layer.mock(Config.Service, { get: () => Effect.succeed({ sandbox: { enabled: true, network: "deny" } }) })), Effect.provideService(InstanceRef, context), Effect.exit, Effect.runPromise)',
    "if (blocked._tag !== 'Failure') process.exit(4)",
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

it.instance("does not let project config weaken an initialized policy", () =>
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
        yield* Effect.promise(() => Bun.write(file, JSON.stringify({ sandbox: { enabled: true, network: "deny" } })))
        yield* config.update({ sandbox: { enabled: true, network: "deny" } })

        const id = SessionID.make("ses_sandbox_config")
        const initial = yield* SandboxPolicy.status(id)
        expect(initial.enabled).toBe(initial.available)
        expect(initial.version).toBe(0)
        if (!initial.available) return

        yield* Effect.promise(() => Bun.write(file, JSON.stringify({ sandbox: { enabled: false, network: "allow" } })))
        yield* config.update({ sandbox: { enabled: false, network: "allow" } })

        expect((yield* config.get()).sandbox?.enabled).toBeUndefined()
        expect(yield* Effect.promise(() => Bun.file(legacy).exists())).toBe(false)
        expect((yield* SandboxPolicy.status(id)).enabled).toBe(true)
        expect(yield* execute(id, sandboxed)).toBe(true)
        expect(Exit.isFailure(yield* execute(id, assertNetwork("https://example.com").pipe(Effect.exit)))).toBe(true)
        expect(yield* SandboxPolicy.peek(test.directory, id)).toMatchObject({ mode: "deny", version: 0 })

        const next = SessionID.make("ses_sandbox_config_next")
        expect((yield* SandboxPolicy.status(next)).enabled).toBe(false)
        expect(yield* execute(next, sandboxed)).toBe(false)
      }),
    (password) => Effect.sync(() => (Flag.KILO_SERVER_PASSWORD = password)),
  ),
)

it.instance("does not enable authless sessions without sandbox enabled", () =>
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

it.instance("applies configured writable paths during tool execution", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const outside = path.join(path.dirname(test.directory), `sandbox-writable-${path.basename(test.directory)}`)
    yield* Effect.promise(() => fs.mkdir(outside, { recursive: true }))
    yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(outside, { recursive: true, force: true })))

    const id = SessionID.make("ses_sandbox_writable_config")
    const result = yield* Effect.gen(function* () {
      const status = yield* SandboxPolicy.status(id)
      if (!status.available) return undefined
      return yield* execute(id, assertWrite(path.join(outside, "allowed.txt")).pipe(Effect.exit))
    }).pipe(
      Effect.provide(
        Layer.mock(Config.Service, {
          get: () => Effect.succeed({ sandbox: { enabled: true, network: "allow", writable_paths: [outside] } }),
        }),
      ),
    )
    if (result === undefined) return
    expect(Exit.isSuccess(result)).toBe(true)
  }),
)

it.instance("refreshes an initialized policy from current settings", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const id = SessionID.make("ses_sandbox_refresh")
    yield* Effect.promise(() =>
      SandboxStore.write(test.directory, id, {
        enabled: false,
        mode: "deny",
        allowedHosts: [],
        writablePaths: [],
        version: 0,
      }),
    )
    yield* SandboxPolicy.peek(test.directory, id)

    const changed = yield* SandboxPolicy.refresh(id).pipe(
      Effect.provide(
        Layer.mock(Config.Service, {
          get: () =>
            Effect.succeed({
              sandbox: { network: "allow", writable_paths: ["~/sandbox-refresh"] },
            }),
        }),
      ),
    )

    expect(changed).toBe(true)
    expect(yield* SandboxPolicy.peek(test.directory, id)).toEqual({
      enabled: false,
      mode: "allow",
      allowedHosts: [],
      writablePaths: [path.join(os.homedir(), "sandbox-refresh")],
      version: 1,
    })
  }),
)

it.instance("uses current settings when enabling an initialized policy", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const id = SessionID.make("ses_sandbox_enable_refresh")
    yield* Effect.promise(() =>
      SandboxStore.write(test.directory, id, {
        enabled: false,
        mode: "deny",
        allowedHosts: [],
        writablePaths: [],
        version: 0,
      }),
    )

    const status = yield* SandboxPolicy.toggle(id).pipe(
      Effect.provide(
        Layer.mock(Config.Service, {
          get: () =>
            Effect.succeed({
              sandbox: { enabled: true, network: "allow", writable_paths: ["/sandbox-enable-refresh"] },
            }),
        }),
      ),
    )

    if (!status.available) {
      expect(status.enabled).toBe(false)
      expect(status.version).toBe(0)
      expect(yield* SandboxPolicy.peek(test.directory, id)).toEqual({
        enabled: false,
        mode: "deny",
        allowedHosts: [],
        writablePaths: [],
        version: 0,
      })
      return
    }

    expect(status.enabled).toBe(true)
    expect(status.version).toBe(1)
    expect(yield* SandboxPolicy.peek(test.directory, id)).toEqual({
      enabled: true,
      mode: "allow",
      allowedHosts: [],
      writablePaths: ["/sandbox-enable-refresh"],
      version: 1,
    })
  }),
)

it.instance("applies trusted settings to inherited sessions", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const parent = SessionID.make("ses_sandbox_refresh_parent")
    const child = SessionID.make("ses_sandbox_refresh_child")
    yield* Effect.promise(() =>
      SandboxStore.write(test.directory, parent, {
        enabled: true,
        mode: "deny",
        allowedHosts: [],
        writablePaths: ["/shared"],
        version: 0,
      }),
    )
    yield* Effect.promise(() =>
      SandboxStore.write(test.directory, child, {
        enabled: false,
        mode: "deny",
        allowedHosts: [],
        writablePaths: ["/shared"],
        version: 0,
      }),
    )
    yield* SandboxPolicy.peek(test.directory, parent)
    yield* SandboxPolicy.peek(test.directory, child)

    const config = Layer.mock(Config.Service, {
      get: () =>
        Effect.succeed({
          sandbox: { network: "allow", writable_paths: ["/shared", "/new"] },
        }),
    })
    yield* SandboxPolicy.refresh(parent).pipe(Effect.provide(config))
    yield* SandboxPolicy.refresh(child).pipe(Effect.provide(config))

    expect(yield* SandboxPolicy.peek(test.directory, parent)).toMatchObject({
      enabled: true,
      mode: "allow",
      writablePaths: ["/shared", "/new"],
    })
    expect(yield* SandboxPolicy.peek(test.directory, child)).toEqual({
      enabled: false,
      mode: "allow",
      allowedHosts: [],
      writablePaths: ["/shared", "/new"],
      version: 1,
    })
  }),
)

it.instance("emits a sandbox status event after refreshing policy", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const id = SessionID.make("ses_sandbox_refresh_event")
    yield* Effect.promise(() =>
      SandboxStore.write(test.directory, id, {
        enabled: true,
        mode: "deny",
        allowedHosts: [],
        writablePaths: [],
        version: 0,
      }),
    )
    const events: Array<{ directory?: string; payload: { type?: string; properties?: { sessionID?: string } } }> = []
    const listener = (event: (typeof events)[number]) => events.push(event)
    GlobalBus.on("event", listener)
    yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", listener)))

    yield* SandboxPolicy.refresh(id).pipe(
      Effect.provide(
        Layer.mock(Config.Service, {
          get: () => Effect.succeed({ sandbox: { network: "allow" } }),
        }),
      ),
    )

    expect(events).toContainEqual(
      expect.objectContaining({
        directory: test.directory,
        payload: expect.objectContaining({
          id: expect.any(String),
          type: "sandbox.status.changed",
          properties: expect.objectContaining({ sessionID: id }),
        }),
      }),
    )
  }),
)

it.instance(
  "runs sandboxed when config is on and no override exists",
  () =>
    Effect.gen(function* () {
      const id = SessionID.make("ses_sandbox_default_on")
      const status = yield* SandboxPolicy.status(id)
      expect(status.enabled).toBe(status.available)
      const result = yield* execute(id, sandboxed).pipe(Effect.exit)
      if (!status.available) {
        expect(Exit.isFailure(result)).toBe(true)
        return
      }
      expect(Exit.isSuccess(result)).toBe(true)
      if (Exit.isSuccess(result)) expect(result.value).toBe(true)
    }),
  { config: { sandbox: { enabled: true } } },
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
  { config: { sandbox: { enabled: true } } },
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
  { config: { sandbox: { enabled: true } } },
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

it.instance("serializes activation with unrestricted tool start", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const id = SessionID.make("ses_sandbox_activation_tool_race")
    if (!(yield* SandboxPolicy.status(id)).available) return
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const family = yield* Deferred.make<void>()
    const preflight = yield* Deferred.make<void>()
    const guard = yield* Deferred.make<void>()
    const running = yield* execute(
      id,
      Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined)
        yield* Deferred.await(release)
        return yield* sandboxed
      }),
    ).pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const activation = yield* SandboxPolicy.toggleGuarded(
      id,
      () => Deferred.succeed(guard, undefined),
      Deferred.succeed(family, undefined).pipe(Effect.as([{ id, directory: test.directory }])),
      () => Deferred.succeed(preflight, undefined),
    ).pipe(Effect.forkChild)
    yield* Deferred.await(family)
    yield* Deferred.await(preflight)
    expect(yield* Deferred.isDone(guard)).toBe(false)

    yield* Deferred.succeed(release, undefined)
    expect(yield* Fiber.join(running)).toBe(false)
    expect((yield* Fiber.join(activation)).enabled).toBe(true)
    expect(yield* Deferred.isDone(guard)).toBe(true)
    expect(yield* execute(id, sandboxed)).toBe(true)
  }),
)

it.instance("refreshes queued tools after config changes", () =>
  (() => {
    const config = { sandbox: { enabled: true, network: "allow" as "allow" | "deny" } }
    return Effect.gen(function* () {
      const id = SessionID.make("ses_sandbox_queued_refresh")
      if (!(yield* SandboxPolicy.status(id)).available) return

      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const running = yield* execute(
        id,
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          return false
        }),
      ).pipe(Effect.forkChild)
      yield* Deferred.await(entered)

      const queued = yield* execute(id, assertNetwork("https://example.com").pipe(Effect.exit)).pipe(Effect.forkChild)
      config.sandbox.network = "deny"
      GlobalBus.emit("event", {
        directory: "global",
        payload: { type: "global.config.updated", properties: { sandbox: true } },
      })
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(running)
      expect(Exit.isFailure(yield* Fiber.join(queued))).toBe(true)
      expect(yield* SandboxPolicy.peek((yield* TestInstance).directory, id)).toMatchObject({ mode: "deny" })
    }).pipe(
      Effect.provide(
        Layer.mock(Config.Service, {
          get: () => Effect.succeed(config),
        }),
      ),
    )
  })(),
)

it.instance("prevents a queued toggle from restoring a retired override", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const id = SessionID.make("ses_sandbox_retire_race")
    if (!(yield* SandboxPolicy.status(id)).available) return
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

      yield* SandboxPolicy.inherit(parent, child, {
        enabled: true,
        mode: "deny",
        allowedHosts: [],
        writablePaths: [],
      })
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
  { config: { sandbox: { enabled: true } } },
)

it.instance("intersects inherited network and write authority", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const parent = SessionID.make("ses_sandbox_intersection_parent")
    const child = SessionID.make("ses_sandbox_intersection_child")
    yield* Effect.promise(() =>
      SandboxStore.write(test.directory, parent, {
        enabled: true,
        mode: "proxy",
        allowedHosts: ["api.github.com:443", "github.com:443"],
        writablePaths: ["/shared", "/parent"],
        version: 0,
      }),
    )
    yield* Effect.promise(() =>
      SandboxStore.write(test.directory, child, {
        enabled: false,
        mode: "proxy",
        allowedHosts: ["api.github.com:443", "example.com:443"],
        writablePaths: ["/child", "/shared"],
        version: 0,
      }),
    )

    yield* SandboxPolicy.inherit(parent, child)
    expect(yield* SandboxPolicy.peek(test.directory, child)).toEqual({
      enabled: true,
      mode: "proxy",
      allowedHosts: ["api.github.com:443"],
      writablePaths: ["/shared"],
      version: 1,
    })
  }),
)

it.instance("refreshes a child inherited while its parent policy is stale", () =>
  (() => {
    const config = { sandbox: { enabled: true, network: "allow" as "allow" | "deny" } }
    return Effect.gen(function* () {
      const parent = SessionID.make("ses_sandbox_stale_parent")
      const child = SessionID.make("ses_sandbox_stale_child")
      yield* SandboxPolicy.status(parent)
      config.sandbox.network = "deny"
      GlobalBus.emit("event", {
        directory: "global",
        payload: { type: "global.config.updated", properties: { sandbox: true } },
      })

      yield* SandboxPolicy.inherit(parent, child)
      yield* SandboxPolicy.status(child)

      expect(yield* SandboxPolicy.peek((yield* TestInstance).directory, child)).toMatchObject({ mode: "deny" })
    }).pipe(
      Effect.provide(
        Layer.mock(Config.Service, {
          get: () => Effect.succeed(config),
        }),
      ),
    )
  })(),
)

it.instance("refreshes a cold child inherited from an untracked stored parent", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const parent = SessionID.make("ses_sandbox_cold_parent")
    const child = SessionID.make("ses_sandbox_cold_child")
    yield* Effect.promise(() =>
      SandboxStore.write(test.directory, parent, {
        enabled: true,
        mode: "allow",
        allowedHosts: [],
        writablePaths: [],
        version: 0,
      }),
    )

    yield* SandboxPolicy.inherit(parent, child)
    yield* SandboxPolicy.status(child)

    expect(yield* SandboxPolicy.peek(test.directory, child)).toMatchObject({ mode: "deny" })
  }),
  { config: { sandbox: { enabled: true, network: "deny" } } },
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
