import { afterEach, describe, expect, test } from "bun:test"
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { createCaffeinationDriver, type CaffeinationDriver } from "../src"

const READY = "KILO_CAFFEINATION_READY"
const HOLD = "process.stdin.resume()"
const drivers = new Set<CaffeinationDriver>()

type Spawn = (command: string, args: string[], opts?: SpawnOptions) => ChildProcess

function driver(platform: NodeJS.Platform, spawn?: Spawn, locate: (name: string) => string | undefined = (name) => name) {
  const value = createCaffeinationDriver({ platform, locate, spawn })
  drivers.add(value)
  return value
}

afterEach(async () => {
  await Promise.all([...drivers].map((value) => value.stop().catch(() => undefined)))
  drivers.clear()
})

describe("caffeination inhibitor", () => {
  test("macOS runs caffeinate against the parent and validates the PID", async () => {
    const calls: { command: string; args: string[]; opts: SpawnOptions }[] = []
    const value = driver("darwin", (command, args, opts = {}) => {
      calls.push({ command, args, opts })
      return nodeSpawn(process.execPath, ["-e", `console.log('${READY}'); ${HOLD}`], {
        ...opts,
        stdio: ["pipe", "pipe", "pipe"],
      })
    })

    for (const pid of [0, -1, 1.5, NaN, Infinity, 2_147_483_648, "1; exit 0" as unknown as number])
      await expect(value.start(pid, () => {})).rejects.toThrow("Invalid parent process ID")
    expect(calls).toHaveLength(0)

    await value.start(process.pid, () => {})
    expect(calls[0]!.command).toBe("/usr/bin/caffeinate")
    expect(calls[0]!.args).toEqual(["-i", "-w", String(process.pid)])
    expect(calls[0]!.opts).toEqual({ detached: false, stdio: ["ignore", "pipe", "pipe"] })
  })

  test.skipIf(process.platform === "win32")(
    "Linux blocks sleep through systemd-inhibit and the watcher ends with its parent",
    async () => {
      const calls: { command: string; args: string[]; opts: SpawnOptions }[] = []
      const value = driver("linux", (command, args, opts = {}) => {
        calls.push({ command, args, opts })
        return nodeSpawn(args[4]!, args.slice(5), opts)
      })
      const parent = nodeSpawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
      const ended = Promise.withResolvers<Error | undefined>()
      try {
        await value.start(parent.pid!, ended.resolve)
        expect(calls[0]!.command).toBe("systemd-inhibit")
        expect(calls[0]!.args.slice(0, 7)).toEqual([
          "--what=sleep",
          "--who=Kilo Code",
          "--why=Kilo agent running",
          "--mode=block",
          "sh",
          "-c",
          expect.stringContaining("KILO_CAFFEINATION_READY"),
        ])
        expect(calls[0]!.opts).toEqual({ detached: true, stdio: ["ignore", "pipe", "pipe"] })
        parent.kill("SIGKILL")
        expect((await ended.promise)?.message).toContain("code 0")
      } finally {
        parent.kill("SIGKILL")
        await value.stop()
      }
    },
  )

  test("an unsupported platform or a missing command reports why Keep Awake is unavailable", async () => {
    const unsupported = driver("freebsd")
    expect(unsupported.available).toBe(false)
    expect(unsupported.reason).toBe("Caffeination is not supported on freebsd")
    await expect(unsupported.start(process.pid, () => {})).rejects.toThrow("Caffeination is not supported on freebsd")

    const missing = driver("darwin", undefined, () => undefined)
    expect(missing.available).toBe(false)
    expect(missing.reason).toBe("The /usr/bin/caffeinate command is not available")
    await expect(missing.start(process.pid, () => {})).rejects.toThrow("The /usr/bin/caffeinate command is not available")
  })
})
