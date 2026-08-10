import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { KiloShutdown } from "../../src/kilocode/cli/shutdown"

const calls: string[] = []
const timeouts: Array<number | undefined> = []
let err: unknown
let drainErr: unknown
let drainCalls = 0
let exit: string | number | null | undefined

mock.module("@opencode-ai/core/global", () => ({
  Global: { Path: { data: "/tmp/kilo-test" } },
}))

mock.module("@opencode-ai/core/installation/version", () => ({
  InstallationBuildKind: "release",
  InstallationVersion: "test",
}))

mock.module("@kilocode/kilo-telemetry", () => ({
  Telemetry: {
    async init() {
      calls.push("telemetry:init")
    },
    async updateIdentity() {},
    trackCliStart() {},
    trackCliExit(code?: number) {
      calls.push(`track:${code ?? "undefined"}`)
    },
    async shutdown(timeout?: number) {
      calls.push("telemetry")
      timeouts.push(timeout)
      if (err) throw err
    },
  },
}))

mock.module("@kilocode/kilo-gateway", () => ({
  ENV_FEATURE: "KILO_FEATURE",
  ENV_VERSION: "KILO_VERSION",
  async migrateLegacyKiloAuth() {
    calls.push("auth:migrate")
  },
}))

mock.module("@/effect/app-runtime", () => ({
  AppRuntime: {
    async runPromise() {
      calls.push("runtime")
    },
    async dispose() {},
  },
}))

mock.module("@/kilocode/log", () => ({
  KiloLog: {
    async init() {
      calls.push("log")
    },
  },
}))

mock.module("@/kilocode/storage/json-migration", () => ({
  JsonMigration: {
    async bootstrap() {
      calls.push("migration")
    },
  },
}))

mock.module("@/config/config", () => ({
  Config: { Service: { use: () => ({ experimental: {} }) } },
}))

mock.module("@/auth", () => ({
  Auth: { Service: { use: () => undefined } },
}))

mock.module("@/project/instance-runtime", () => ({
  InstanceRuntime: {
    async disposeAllInstances() {
      calls.push("dispose")
    },
  },
}))

mock.module("@/kilocode/session-export", () => ({
  SessionExport: {
    async shutdown() {
      calls.push("session")
    },
  },
}))

mock.module("@/kilo-sessions/kilo-sessions", () => ({
  KiloSessions: {
    async drainIngestForShutdown() {
      drainCalls += 1
      calls.push("drain")
      if (drainErr) throw drainErr
    },
  },
}))

mock.module("@/kilocode/help-command", () => ({
  createHelpCommand: () => ({ command: "help", handler() {} }),
}))

for (const path of [
  "@/kilocode/cli/cmd/console",
  "@/kilocode/cli/cmd/cloud",
  "@/kilocode/cli/cmd/roll-call",
  "@/kilocode/cli/cmd/profile",
  "@/kilocode/cli/cmd/daemon",
  "@/kilocode/cli/dev-setup",
  "@/cli/cmd/remote",
  "@/cli/cmd/config",
]) {
  mock.module(path, () => ({
    KiloConsoleCommand: { command: "console", handler() {} },
    CloudCommand: { command: "cloud", handler() {} },
    RollCallCommand: { command: "roll-call", handler() {} },
    ProfileCommand: { command: "profile", handler() {} },
    DaemonCommand: { command: "daemon", handler() {} },
    DevSetupCommand: { command: "dev-setup", handler() {} },
    DevAliasCommand: { command: "dev-alias", handler() {} },
    RemoteCommand: { command: "remote", handler() {} },
    ConfigCommand: { command: "config", handler() {} },
  }))
}

/** Same mock body as the kilo-sessions module mock used by setup.ts's drain task. */
function registerDrain() {
  KiloShutdown.register(async () => {
    drainCalls += 1
    calls.push("drain")
    if (drainErr) throw drainErr
  })
}

/**
 * Install a drain task for this test only. Clears any leftover registry entries first
 * (setup.ts's one-time module-scope registration, or a prior test) so assertions do not
 * depend on declaration order or on whether an earlier test already ran KiloShutdown.run().
 */
async function installDrain() {
  await KiloShutdown.run()
  calls.length = 0
  drainCalls = 0
  registerDrain()
}

describe("KiloCli.shutdown", () => {
  beforeEach(() => {
    calls.length = 0
    timeouts.length = 0
    err = undefined
    drainErr = undefined
    drainCalls = 0
    exit = process.exitCode
    process.exitCode = undefined
  })

  afterEach(() => {
    process.exitCode = exit
  })

  // Must stay first: setup registers the drain task once at import; KiloShutdown.run() clears it.
  // Only this test pins that one-time module-scope registration (and the drain-before-dispose
  // ordering it enables). Later tests call installDrain() so they do not rely on order.
  test("rejects drain without blocking dispose", async () => {
    drainErr = new Error("ingest drain failed")
    process.exitCode = 0
    const { KiloCli } = await import("../../src/kilocode/cli/setup")

    await expect(KiloCli.shutdown()).resolves.toBeUndefined()

    expect(drainCalls).toBe(1)
    expect(timeouts).toEqual([2000])
    expect(calls).toEqual(["track:0", "session", "telemetry", "drain", "dispose"])
    expect(process.exitCode).toBe(0)
  })

  test("keeps telemetry shutdown timeout best-effort and still disposes instances", async () => {
    err = "Timeout while shutting down PostHog. Some events may not have been sent."
    process.exitCode = 0
    const { KiloCli } = await import("../../src/kilocode/cli/setup")
    await installDrain()

    await expect(KiloCli.shutdown()).resolves.toBeUndefined()

    expect(timeouts).toEqual([2000])
    expect(calls).toEqual(["track:0", "session", "telemetry", "drain", "dispose"])
    expect(process.exitCode).toBe(0)
  })

  test("preserves failing command exit status", async () => {
    process.exitCode = 1
    const { KiloCli } = await import("../../src/kilocode/cli/setup")
    await installDrain()

    await KiloCli.shutdown()

    expect(timeouts).toEqual([2000])
    expect(calls).toEqual(["track:1", "session", "telemetry", "drain", "dispose"])
    expect(process.exitCode).toBe(1)
  })

  test("skips lifecycle work for parsed informational flags", async () => {
    const { KiloCli } = await import("../../src/kilocode/cli/setup")
    await installDrain()

    for (const flag of ["help", "version"] as const) {
      await KiloCli.bootstrap({ [flag]: true })
      await KiloCli.shutdown()
    }

    expect(calls).toEqual([])
    expect(timeouts).toEqual([])
  })
})
