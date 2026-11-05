import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { Global } from "@opencode/util/global"
import { assertNetwork, assertWrite, enabled, run as runSandbox } from "@kilocode/sandbox"
import { Session } from "@opencode/schema/session"
import * as SandboxPolicy from "../../src/sandbox/policy"
import { Runtime } from "../../src/sandbox/runtime"
import { SandboxPreference } from "../../src/sandbox/preference"
import { SandboxStore } from "../../src/sandbox/store"
import { addSession, cleanup, harness, provide, session, tempdir, type Harness } from "./support"

afterAll(cleanup)

const posix = process.platform === "win32" ? test.skip : test
const id = (value: string) => Session.ID.make(value)
const kilo = [
  Global.Path.data,
  Global.Path.cache,
  Global.Path.config,
  Global.Path.state,
  Global.Path.tmp,
  Global.Path.bin,
  Global.Path.log,
  Global.Path.repos,
]

type Dirs = {
  main: string
  local: string
  separate: string
  separateLocal: string
  a: string
  b: string
  external: string
  approved: string
}

async function layout(): Promise<Dirs> {
  const root = await tempdir()
  const main = path.join(root, "main")
  const local = path.join(main, "packages", "app")
  const separate = path.join(root, "separate")
  const separateLocal = path.join(separate, "packages", "app")
  const store = path.join(root, "separate-git")
  const a = path.join(main, ".kilo", "worktrees", "a")
  const b = path.join(main, ".kilo", "worktrees", "b")
  const external = path.join(root, "imported")
  const approved = path.join(root, "approved")
  await Promise.all(
    [path.join(main, ".git"), local, separateLocal, store, a, b, external, approved].map((dir) =>
      fs.mkdir(dir, { recursive: true }),
    ),
  )
  await fs.writeFile(path.join(separate, ".git"), `gitdir: ${store}\n`)
  await Promise.all(
    [a, b, external].map(async (dir, index) => {
      const git = path.join(root, "worktrees", String(index))
      await fs.mkdir(git, { recursive: true })
      await fs.writeFile(path.join(git, "commondir"), "../..\n")
      await fs.writeFile(path.join(dir, ".git"), `gitdir: ${git}\n`)
    }),
  )
  return { main, local, separate, separateLocal, a, b, external, approved }
}

function context(directory: string, worktree: string) {
  return { directory, worktree }
}

function roots(directory: string, worktree: string) {
  return SandboxPolicy.profile(context(directory, worktree)).filesystem.allowWrite.map((rule) => rule.path)
}

function expected(...directories: string[]) {
  return new Set([...directories, ...kilo])
}

function execute<A, E>(value: Harness, effect: Effect.Effect<A, E, Runtime>) {
  return Effect.runPromise(provide(value, effect).pipe(Effect.orDie))
}

describe("sandbox policy profile", () => {
  test("keeps a normal checkout writable from an active subdirectory", async () => {
    const dirs = await layout()
    const result = roots(dirs.local, dirs.main)
    const write = await Effect.runPromise(
      runSandbox(
        SandboxPolicy.profile(context(dirs.local, dirs.main)),
        assertWrite(path.join(dirs.main, "outside-cwd.txt")).pipe(Effect.exit),
      ),
    )

    expect(new Set(result)).toEqual(expected(dirs.main, dirs.local))
    expect(result).not.toContain(dirs.a)
    expect(result).not.toContain(dirs.b)
    expect(Exit.isSuccess(write)).toBe(true)
  })

  test("keeps a separate git directory checkout writable from an active subdirectory", async () => {
    const dirs = await layout()
    const result = roots(dirs.separateLocal, dirs.separate)
    expect(new Set(result)).toEqual(expected(dirs.separate, dirs.separateLocal))
  })

  test("confines a managed worktree to its active directory", async () => {
    const dirs = await layout()
    const actual = roots(dirs.a, dirs.a)
    const shared = roots(dirs.a, dirs.main)

    expect(new Set(actual)).toEqual(expected(dirs.a))
    expect(new Set(shared)).toEqual(expected(dirs.a))
    expect(actual).not.toContain(dirs.main)
    expect(actual).not.toContain(dirs.b)
  })

  test("drops inherited writable ancestors for a managed worktree", async () => {
    const dirs = await layout()
    const policy = SandboxPolicy.profile(context(dirs.a, dirs.main), "deny", [dirs.main, dirs.approved])
    const paths = policy.filesystem.allowWrite.map((rule) => rule.path)

    expect(paths).not.toContain(dirs.main)
    expect(paths).toContain(dirs.approved)
    expect(paths).toContain(dirs.a)
  })

  posix("fails closed when a worktree marker cannot be resolved", async () => {
    const dirs = await layout()
    await fs.symlink(".git", path.join(dirs.local, ".git"))
    const result = roots(dirs.local, dirs.main)

    expect(new Set(result)).toEqual(expected(dirs.local))
    expect(result).not.toContain(dirs.main)
  })

  test("confines an imported worktree to its active directory", async () => {
    const dirs = await layout()
    const result = roots(dirs.external, dirs.external)

    expect(new Set(result)).toEqual(expected(dirs.external))
    expect(result).not.toContain(dirs.main)
    expect(result).not.toContain(dirs.a)
    expect(result).not.toContain(dirs.b)
  })

  test("derives concurrent worktree profiles without cross-contamination", async () => {
    const dirs = await layout()
    const check = (own: string, other: string) =>
      runSandbox(
        SandboxPolicy.profile(context(own, own)),
        Effect.all({
          own: assertWrite(path.join(own, "allowed.txt")).pipe(Effect.exit),
          other: assertWrite(path.join(other, "denied.txt")).pipe(Effect.exit),
        }),
      )
    const [left, right] = await Effect.runPromise(
      Effect.all([check(dirs.a, dirs.b), check(dirs.b, dirs.a)], { concurrency: "unbounded" }),
    )

    expect(Exit.isSuccess(left.own)).toBe(true)
    expect(Exit.isFailure(left.other)).toBe(true)
    expect(Exit.isSuccess(right.own)).toBe(true)
    expect(Exit.isFailure(right.other)).toBe(true)
  })

  test("keeps Kilo state writable without exposing sandbox policy state", async () => {
    const dirs = await layout()
    const policy = SandboxPolicy.profile(context(dirs.a, dirs.a))
    const [dataWrite, storeWrite, prefWrite] = await Effect.runPromise(
      Effect.all([
        runSandbox(policy, assertWrite(path.join(Global.Path.data, "state.txt"))).pipe(Effect.exit),
        runSandbox(policy, assertWrite(SandboxStore.root)).pipe(Effect.exit),
        runSandbox(policy, assertWrite(SandboxPreference.root)).pipe(Effect.exit),
      ]),
    )

    expect(new Set(roots(dirs.a, dirs.a))).toEqual(expected(dirs.a))
    expect(policy.filesystem.temporaryDirectory).toBe(Global.Path.tmp)
    expect(policy.filesystem.denyWrite.map((rule) => rule.path)).toContain(path.dirname(SandboxStore.root))
    expect(policy.filesystem.denyWrite.map((rule) => rule.path)).toContain(Global.Path.config)
    expect(policy.environment.deny).toContain("KILO_CONFIG")
    expect(policy.environment.deny).toContain("KILO_SERVER_PASSWORD")
    expect(policy.environment.deny).toContain("OPENCODE_CONFIG")
    expect(Exit.isSuccess(dataWrite)).toBe(true)
    expect(Exit.isFailure(storeWrite)).toBe(true)
    expect(Exit.isFailure(prefWrite)).toBe(true)
  })

  test("uses deny-by-default and configurable network profiles", async () => {
    const dirs = await layout()
    expect(SandboxPolicy.profile(context(dirs.a, dirs.a)).network).toEqual({ mode: "deny", allowedHosts: [] })
    expect(SandboxPolicy.profile(context(dirs.a, dirs.a), "allow").network).toEqual({
      mode: "allow",
      allowedHosts: [],
    })
    expect(SandboxPolicy.profile(context(dirs.a, dirs.a), "proxy", [], ["api.github.com:443"]).network).toEqual({
      mode: "proxy",
      allowedHosts: ["api.github.com:443"],
    })
  })

  test("keeps .git denied inside overlapping writable roots", async () => {
    const dirs = await layout()
    const linked = context(dirs.a, dirs.a)
    const local = context(dirs.local, dirs.main)
    const result = await Effect.runPromise(
      Effect.all([
        runSandbox(SandboxPolicy.profile(linked), assertWrite(path.join(dirs.a, ".git")).pipe(Effect.exit)),
        runSandbox(
          SandboxPolicy.profile(linked),
          assertWrite(path.join(dirs.a, "nested", ".git", "config")).pipe(Effect.exit),
        ),
        runSandbox(
          SandboxPolicy.profile(local),
          assertWrite(path.join(dirs.main, ".git", "config")).pipe(Effect.exit),
        ),
      ]),
    )

    expect(result.every(Exit.isFailure)).toBe(true)
    expect(SandboxPolicy.profile(linked).filesystem.denyNames).toContain(".git")
  })

  test("does not add externally approved paths to writable roots", async () => {
    const dirs = await layout()
    const result = await Effect.runPromise(
      runSandbox(
        SandboxPolicy.profile(context(dirs.a, dirs.a)),
        assertWrite(path.join(dirs.approved, "denied.txt")).pipe(Effect.exit),
      ),
    )

    expect(roots(dirs.a, dirs.a)).not.toContain(dirs.approved)
    expect(Exit.isFailure(result)).toBe(true)
  })

  test("makes configured extra writable paths writable while unlisted paths stay denied", async () => {
    const dirs = await layout()
    const policy = SandboxPolicy.profile(context(dirs.a, dirs.a), "deny", [dirs.approved])
    const result = await Effect.runPromise(
      Effect.all({
        extra: runSandbox(policy, assertWrite(path.join(dirs.approved, "allowed.txt")).pipe(Effect.exit)),
        other: runSandbox(policy, assertWrite(path.join(dirs.b, "denied.txt")).pipe(Effect.exit)),
      }),
    )

    expect(policy.filesystem.allowWrite.map((rule) => rule.path)).toContain(dirs.approved)
    expect(roots(dirs.a, dirs.a)).not.toContain(dirs.approved)
    expect(Exit.isSuccess(result.extra)).toBe(true)
    expect(Exit.isFailure(result.other)).toBe(true)
  })

  test("keeps .git denied inside a configured extra writable path", async () => {
    const dirs = await layout()
    const policy = SandboxPolicy.profile(context(dirs.a, dirs.a), "deny", [dirs.approved])
    const result = await Effect.runPromise(
      runSandbox(policy, assertWrite(path.join(dirs.approved, ".git", "config")).pipe(Effect.exit)),
    )

    expect(Exit.isFailure(result)).toBe(true)
  })
})

describe("sandbox policy state", () => {
  test("starts disabled with a deny network by default", async () => {
    const directory = await tempdir()
    const value = harness({ directory })
    const sessionID = id("ses_policy_default")

    const status = await execute(value, SandboxPolicy.status(sessionID))

    expect(status).toMatchObject({ directory, enabled: false, version: 0, network: false })
    expect(await SandboxStore.read(directory, sessionID)).toEqual({
      enabled: false,
      mode: "deny",
      allowedHosts: [],
      writablePaths: [],
      version: 0,
    })
  })

  test("applies the configured defaults to a new session", async () => {
    const directory = await tempdir()
    const value = harness({
      directory,
      config: {
        sandbox: {
          enabled: true,
          network: "deny",
          allowed_hosts: ["API.GITHUB.COM."],
          writable_paths: ["~/sandbox-output"],
        },
      },
    })
    const sessionID = id("ses_policy_configured")

    const status = await execute(value, SandboxPolicy.status(sessionID))

    expect(status.enabled).toBe(status.available)
    expect(await SandboxStore.read(directory, sessionID)).toEqual({
      enabled: true,
      mode: "proxy",
      allowedHosts: ["api.github.com:443"],
      writablePaths: [path.join(os.homedir(), "sandbox-output")],
      version: 0,
    })
  })

  test("keeps a create-time session choice over the config default", async () => {
    const directory = await tempdir()
    const value = harness({ directory, config: { sandbox: { enabled: false } } })
    addSession(
      value,
      session("ses_policy_chosen", directory, { metadata: { "kilocode.sandbox": { enabled: true, version: 0 } } }),
    )

    const status = await execute(value, SandboxPolicy.status(id("ses_policy_chosen")))

    expect(status.enabled).toBe(status.available)
    expect((await SandboxStore.read(directory, id("ses_policy_chosen")))?.enabled).toBe(true)
  })

  test("uses the persisted directory preference over the config default", async () => {
    const directory = await tempdir()
    const value = harness({ directory, config: { sandbox: { enabled: false } } })
    await SandboxPreference.write(directory, true)

    const status = await execute(value, SandboxPolicy.status(id("ses_policy_preference")))

    expect(status.enabled).toBe(status.available)
    expect((await SandboxStore.read(directory, id("ses_policy_preference")))?.enabled).toBe(true)
  })

  test("persists a toggle so new sessions inherit the last choice", async () => {
    const directory = await tempdir()
    const value = harness({ directory, config: { sandbox: { enabled: true } } })
    const first = id("ses_policy_persist_off")
    const second = id("ses_policy_persist_inherit")
    if (!(await execute(value, SandboxPolicy.status(first))).available) return

    expect((await execute(value, SandboxPolicy.toggle(first))).enabled).toBe(false)
    expect(await execute(value, SandboxPolicy.executeTool(first, { id: "read" }, enabled))).toBe(false)
    expect((await execute(value, SandboxPolicy.status(second))).enabled).toBe(false)
    expect(await execute(value, SandboxPolicy.executeTool(second, { id: "read" }, enabled))).toBe(false)
  })

  test("remembers a later toggle back on for new sessions", async () => {
    const directory = await tempdir()
    const value = harness({ directory, config: { sandbox: { enabled: true } } })
    const first = id("ses_policy_roundtrip_a")
    const second = id("ses_policy_roundtrip_b")
    const third = id("ses_policy_roundtrip_c")
    if (!(await execute(value, SandboxPolicy.status(first))).available) return

    await execute(value, SandboxPolicy.toggle(first))
    expect((await execute(value, SandboxPolicy.status(second))).enabled).toBe(false)
    await execute(value, SandboxPolicy.toggle(second))
    expect((await execute(value, SandboxPolicy.status(third))).enabled).toBe(true)
    expect(await execute(value, SandboxPolicy.executeTool(third, { id: "read" }, enabled))).toBe(true)
  })

  test("isolates concurrent session overrides and clears them on dispose", async () => {
    const directory = await tempdir()
    const value = harness({ directory, config: { sandbox: { enabled: false } } })
    const first = id("ses_policy_first")
    const second = id("ses_policy_second")
    if (!(await execute(value, SandboxPolicy.status(first))).available) return

    expect((await execute(value, SandboxPolicy.status(second))).enabled).toBe(false)
    expect((await execute(value, SandboxPolicy.toggle(first))).enabled).toBe(true)
    expect((await execute(value, SandboxPolicy.status(second))).enabled).toBe(false)
    expect((await execute(value, SandboxPolicy.toggle(second))).enabled).toBe(true)
    expect((await execute(value, SandboxPolicy.toggle(second))).enabled).toBe(false)
    expect((await execute(value, SandboxPolicy.status(first))).enabled).toBe(true)

    expect(await execute(value, SandboxPolicy.dispose(first, Effect.succeed("disposed")))).toBe("disposed")
    expect((await execute(value, SandboxPolicy.status(first))).enabled).toBe(false)
    expect((await execute(value, SandboxPolicy.status(second))).enabled).toBe(false)
  })

  test("serializes concurrent toggles for a session", async () => {
    const directory = await tempdir()
    const value = harness({ directory })
    const sessionID = id("ses_policy_concurrent")
    if (!(await execute(value, SandboxPolicy.status(sessionID))).available) return

    await execute(
      value,
      Effect.all([SandboxPolicy.toggle(sessionID), SandboxPolicy.toggle(sessionID)], {
        concurrency: "unbounded",
      }),
    )
    expect((await execute(value, SandboxPolicy.status(sessionID))).enabled).toBe(false)
  })

  test("refreshes an initialized policy from current settings", async () => {
    const directory = await tempdir()
    const value = harness({ directory, config: { sandbox: { enabled: true, network: "allow" } } })
    const sessionID = id("ses_policy_refresh")
    await execute(value, SandboxPolicy.status(sessionID))

    value.config = { sandbox: { network: "deny", writable_paths: ["~/sandbox-refresh"] } }
    SandboxPolicy.configChanged()
    const changed = await execute(value, SandboxPolicy.refresh(sessionID))

    expect(changed).toBe(true)
    expect(await SandboxStore.read(directory, sessionID)).toEqual({
      enabled: true,
      mode: "deny",
      allowedHosts: [],
      writablePaths: [path.join(os.homedir(), "sandbox-refresh")],
      version: 1,
    })
    expect(value.published.at(-1)).toMatchObject({
      sessionID,
      directory,
      enabled: true,
      network: true,
      version: 1,
    })
  })

  test("uses current settings when enabling an initialized policy", async () => {
    const directory = await tempdir()
    const value = harness({
      directory,
      config: { sandbox: { enabled: true, network: "allow", writable_paths: ["/sandbox-enable-refresh"] } },
    })
    const sessionID = id("ses_policy_enable_refresh")
    await SandboxStore.write(directory, sessionID, {
      enabled: false,
      mode: "deny",
      allowedHosts: [],
      writablePaths: [],
      version: 0,
    })

    const status = await execute(value, SandboxPolicy.toggle(sessionID))
    if (!status.available) {
      expect(status.enabled).toBe(false)
      expect(status.version).toBe(0)
      return
    }

    expect(status.enabled).toBe(true)
    expect(status.version).toBe(1)
    expect(await SandboxStore.read(directory, sessionID)).toEqual({
      enabled: true,
      mode: "allow",
      allowedHosts: [],
      writablePaths: ["/sandbox-enable-refresh"],
      version: 1,
    })
  })

  test("applies configured writable paths during tool execution", async () => {
    const directory = await tempdir()
    const outside = path.join(path.dirname(directory), `sandbox-writable-${path.basename(directory)}`)
    const unlisted = path.join(path.dirname(directory), `sandbox-unlisted-${path.basename(directory)}`)
    await Promise.all([fs.mkdir(outside, { recursive: true }), fs.mkdir(unlisted, { recursive: true })])
    const value = harness({
      directory,
      config: { sandbox: { enabled: true, network: "allow", writable_paths: [outside] } },
    })
    const sessionID = id("ses_policy_writable_config")
    const status = await execute(value, SandboxPolicy.status(sessionID))
    if (!status.available) return

    const { extra, other } = await execute(
      value,
      Effect.all({
        extra: SandboxPolicy.executeTool(
          sessionID,
          { id: "write" },
          assertWrite(path.join(outside, "allowed.txt")),
        ).pipe(Effect.exit),
        other: SandboxPolicy.executeTool(
          sessionID,
          { id: "write" },
          assertWrite(path.join(unlisted, "denied.txt")),
        ).pipe(Effect.exit),
      }),
    )

    expect(Exit.isSuccess(extra)).toBe(true)
    expect(Exit.isFailure(other)).toBe(true)
  })

  test("runs tools unrestricted while the session is disabled", async () => {
    const directory = await tempdir()
    const value = harness({ directory })
    const sessionID = id("ses_policy_unrestricted")

    expect(await execute(value, SandboxPolicy.executeTool(sessionID, { id: "read" }, enabled))).toBe(false)
    expect((await execute(value, SandboxPolicy.status(sessionID))).enabled).toBe(false)
  })

  test("does not activate an unavailable backend", async () => {
    const directory = await tempdir()
    const value = harness({ directory })
    const status = await execute(value, SandboxPolicy.toggle(id("ses_policy_support")))

    if (status.available) expect(status.enabled).toBe(true)
    else {
      expect(status.enabled).toBe(false)
      expect(status.reason?.length).toBeGreaterThan(0)
    }
  })
})

describe("sandbox policy activation", () => {
  test("serializes activation with unrestricted tool start", async () => {
    const directory = await tempdir()
    const value = harness({ directory })
    const sessionID = id("ses_policy_activation_tool_race")
    if (!(await execute(value, SandboxPolicy.status(sessionID))).available) return

    const program = Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const family = yield* Deferred.make<void>()
      const preflight = yield* Deferred.make<void>()
      const guard = yield* Deferred.make<void>()
      const running = yield* SandboxPolicy.executeTool(
        sessionID,
        { id: "read" },
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          return yield* enabled
        }),
      ).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      const activation = yield* SandboxPolicy.toggleGuarded(
        sessionID,
        () => Deferred.succeed(guard, undefined),
        Deferred.succeed(family, undefined).pipe(Effect.as([{ id: sessionID, directory }])),
        () => Deferred.succeed(preflight, undefined),
      ).pipe(Effect.forkChild)
      yield* Deferred.await(family)
      yield* Deferred.await(preflight)
      expect(yield* Deferred.isDone(guard)).toBe(false)

      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(running)).toBe(false)
      expect((yield* Fiber.join(activation)).enabled).toBe(true)
      expect(yield* Deferred.isDone(guard)).toBe(true)
      expect(yield* SandboxPolicy.executeTool(sessionID, { id: "read" }, enabled)).toBe(true)
    })

    await Effect.runPromise(provide(value, program))
  })

  test("refreshes queued tools after config changes", async () => {
    const directory = await tempdir()
    const value = harness({ directory, config: { sandbox: { enabled: true, network: "allow" } } })
    const sessionID = id("ses_policy_queued_refresh")
    if (!(await execute(value, SandboxPolicy.status(sessionID))).available) return

    const program = Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const running = yield* SandboxPolicy.executeTool(
        sessionID,
        { id: "read" },
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
          return false
        }),
      ).pipe(Effect.forkChild)
      yield* Deferred.await(entered)

      const queued = yield* SandboxPolicy.executeTool(
        sessionID,
        { id: "webfetch" },
        assertNetwork("https://example.com").pipe(Effect.exit),
      ).pipe(Effect.forkChild)
      if (value.config.sandbox) value.config.sandbox.network = "deny"
      SandboxPolicy.configChanged()
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(running)
      expect(Exit.isFailure(yield* Fiber.join(queued))).toBe(true)
    })

    await Effect.runPromise(provide(value, program))
    expect(await SandboxStore.read(directory, sessionID)).toMatchObject({ mode: "deny" })
  })
})
