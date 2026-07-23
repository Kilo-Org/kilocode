import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { KiloCli } from "../../src/kilocode/cli/setup"
import { KiloShutdown } from "../../src/kilocode/cli/shutdown"
import { SessionExport } from "../../src/kilocode/session-export"
import { InstanceRuntime } from "../../src/project/instance-runtime"

const calls: string[] = []
const timeouts: Array<number | undefined> = []
let err: unknown
let exit: string | number | null | undefined
let reset = () => {}

describe("KiloCli.shutdown", () => {
  beforeEach(() => {
    calls.length = 0
    timeouts.length = 0
    err = undefined
    exit = process.exitCode
    process.exitCode = undefined
    const init = spyOn(Telemetry, "init").mockImplementation(async () => {})
    const identity = spyOn(Telemetry, "updateIdentity").mockImplementation(async () => {})
    const start = spyOn(Telemetry, "trackCliStart").mockImplementation(() => {})
    const track = spyOn(Telemetry, "trackCliExit").mockImplementation((code) => {
      calls.push(`track:${code ?? "undefined"}`)
    })
    const shutdown = spyOn(Telemetry, "shutdown").mockImplementation(async (timeout) => {
      calls.push("telemetry")
      timeouts.push(timeout)
      if (err) throw err
    })
    const session = spyOn(SessionExport, "shutdown").mockImplementation(async () => {
      calls.push("session")
    })
    const dispose = spyOn(InstanceRuntime, "disposeAllInstances").mockImplementation(async () => {
      calls.push("dispose")
    })
    const run = spyOn(KiloShutdown, "run")
    reset = () => {
      init.mockRestore()
      identity.mockRestore()
      start.mockRestore()
      track.mockRestore()
      shutdown.mockRestore()
      session.mockRestore()
      dispose.mockRestore()
      run.mockRestore()
    }
  })

  afterEach(() => {
    reset()
    process.exitCode = exit
  })

  test("keeps telemetry shutdown timeout best-effort and still disposes instances", async () => {
    err = "Timeout while shutting down PostHog. Some events may not have been sent."
    process.exitCode = 0

    await expect(KiloCli.shutdown()).resolves.toBeUndefined()

    expect(timeouts).toEqual([2000])
    expect(calls).toEqual(["track:0", "session", "telemetry", "dispose"])
    expect(process.exitCode).toBe(0)
  })

  test("preserves failing command exit status", async () => {
    process.exitCode = 1

    await KiloCli.shutdown()

    expect(timeouts).toEqual([2000])
    expect(calls).toEqual(["track:1", "session", "telemetry", "dispose"])
    expect(process.exitCode).toBe(1)
  })
})
