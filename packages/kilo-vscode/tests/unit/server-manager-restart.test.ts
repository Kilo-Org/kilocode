import { describe, expect, mock, test } from "bun:test"
import {
  ServerManager,
  terminateProcessForRestart,
  type RestartProcessControls,
} from "../../src/services/cli-backend/server-manager"

interface FakeControls extends RestartProcessControls {
  readonly signals: NodeJS.Signals[]
  setAlive: (alive: boolean) => void
}

function makeControls(initialAlive = true): FakeControls {
  let alive = initialAlive
  const signals: NodeJS.Signals[] = []
  return {
    signals,
    setAlive: (value: boolean) => {
      alive = value
    },
    kill: (signal) => {
      signals.push(signal)
      // Mirror well-behaved processes: SIGTERM/SIGKILL terminate immediately unless the test overrides.
      alive = false
    },
    isAlive: () => alive,
    waitForExit: async () => {},
  }
}

describe("terminateProcessForRestart", () => {
  test("stops after SIGTERM when the process exits", async () => {
    const controls = makeControls(true)
    await terminateProcessForRestart(controls, () => false)
    expect(controls.signals).toEqual(["SIGTERM"])
    expect(controls.isAlive()).toBe(false)
  })

  test("escalates to SIGKILL when SIGTERM is ignored", async () => {
    const controls = makeControls(true)
    // The process ignores SIGTERM but honors SIGKILL.
    controls.kill = (signal) => {
      controls.signals.push(signal)
      controls.setAlive(signal !== "SIGKILL")
    }
    await terminateProcessForRestart(controls, () => false)
    expect(controls.signals).toEqual(["SIGTERM", "SIGKILL"])
    expect(controls.isAlive()).toBe(false)
  })

  test("refuses to start a replacement when the process survives SIGKILL", async () => {
    const controls = makeControls(true)
    controls.kill = (signal) => controls.signals.push(signal) // never flips alive
    await expect(terminateProcessForRestart(controls, () => false)).rejects.toThrow(/survived SIGKILL/)
    expect(controls.signals).toEqual(["SIGTERM", "SIGKILL"])
    expect(controls.isAlive()).toBe(true)
  })

  test("aborts without SIGKILL when disposed during the SIGTERM wait", async () => {
    const controls = makeControls(true)
    let disposed = false
    controls.waitForExit = async () => {
      disposed = true
    }
    await expect(terminateProcessForRestart(controls, () => disposed)).rejects.toThrow(/disposed/)
    expect(controls.signals).toEqual(["SIGTERM"])
  })

  test("aborts when disposed after the process has exited", async () => {
    const controls = makeControls(true)
    await expect(terminateProcessForRestart(controls, () => true)).rejects.toThrow(/disposed/)
    expect(controls.signals).toEqual(["SIGTERM"])
  })
})

describe("ServerManager.restart", () => {
  function makeManager() {
    const manager = new ServerManager({} as any)
    // A fake already-dead process: pid undefined makes killProcess a no-op and undefined exit
    // codes make isProcessAlive() report false, so no real process is touched.
    ;(manager as any).instance = {
      port: 1111,
      password: "old",
      process: { pid: undefined, exitCode: undefined, signalCode: undefined, on: () => {}, once: () => {} },
    }
    const replacement = { port: 2222, password: "new", process: {} }
    const getServer = mock(async () => {
      // Mirror the real getServer, which publishes the started instance before returning.
      ;(manager as any).instance = replacement
      return replacement
    })
    ;(manager as any).getServer = getServer
    return { manager, replacement, getServer }
  }

  test("concurrent restarts are single-flight and share the replacement", async () => {
    const { manager, replacement, getServer } = makeManager()
    const [first, second] = await Promise.all([manager.restart(), manager.restart()])
    expect(first).toBe(replacement)
    expect(second).toBe(replacement)
    expect(getServer).toHaveBeenCalledTimes(1)
    // The stale instance reference must be cleared before the replacement is started.
    expect((manager as any).instance).toBe(replacement)
  })

  test("restart without a current instance still starts one through getServer", async () => {
    const manager = new ServerManager({} as any)
    const replacement = { port: 3333, password: "fresh", process: {} }
    const getServer = mock(async () => replacement)
    ;(manager as any).getServer = getServer
    expect(await manager.restart()).toBe(replacement)
    expect(getServer).toHaveBeenCalledTimes(1)
  })

  test("rejects after dispose and never starts a replacement", async () => {
    const { manager, getServer } = makeManager()
    manager.dispose()
    await expect(manager.restart()).rejects.toThrow(/disposed/)
    expect(getServer).not.toHaveBeenCalled()
  })
})
