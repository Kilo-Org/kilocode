import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

const calls: string[] = []
const timeouts: Array<number | undefined> = []
let err: unknown
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
    async init() {},
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
  async migrateLegacyKiloAuth() {},
}))

mock.module("@/effect/app-runtime", () => ({
  AppRuntime: {
    async runPromise() {},
    async dispose() {},
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

mock.module("@/kilocode/help-command", () => ({
  createHelpCommand: () => ({ command: "help", handler() {} }),
}))

for (const path of [
  "@/kilocode/cli/cmd/console",
  "@/kilocode/cli/cmd/roll-call",
  "@/kilocode/cli/cmd/profile",
  "@/kilocode/cli/cmd/daemon",
  "@/kilocode/cli/dev-setup",
  "@/cli/cmd/remote",
  "@/cli/cmd/config",
]) {
  mock.module(path, () => ({
    KiloConsoleCommand: { command: "console", handler() {} },
    RollCallCommand: { command: "roll-call", handler() {} },
    ProfileCommand: { command: "profile", handler() {} },
    DaemonCommand: { command: "daemon", handler() {} },
    DevSetupCommand: { command: "dev-setup", handler() {} },
    DevAliasCommand: { command: "dev-alias", handler() {} },
    RemoteCommand: { command: "remote", handler() {} },
    ConfigCommand: { command: "config", handler() {} },
  }))
}

describe("KiloCli.shutdown", () => {
  beforeEach(() => {
    calls.length = 0
    timeouts.length = 0
    err = undefined
    exit = process.exitCode
    process.exitCode = undefined
  })

  afterEach(() => {
    process.exitCode = exit
  })

  test("keeps telemetry shutdown timeout best-effort and still disposes instances", async () => {
    err = "Timeout while shutting down PostHog. Some events may not have been sent."
    process.exitCode = 0
    const { KiloCli } = await import("../../src/kilocode/cli/setup")

    await expect(KiloCli.shutdown()).resolves.toBeUndefined()

    expect(timeouts).toEqual([2000])
    expect(calls).toEqual(["track:0", "session", "telemetry", "dispose"])
    expect(process.exitCode).toBe(0)
  })

  test("preserves failing command exit status", async () => {
    process.exitCode = 1
    const { KiloCli } = await import("../../src/kilocode/cli/setup")

    await KiloCli.shutdown()

    expect(timeouts).toEqual([2000])
    expect(calls).toEqual(["track:1", "session", "telemetry", "dispose"])
    expect(process.exitCode).toBe(1)
  })
})
