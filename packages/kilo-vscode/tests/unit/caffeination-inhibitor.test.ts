import { afterEach, describe, expect, it } from "bun:test"
import { once } from "node:events"
import type { ChildProcess, SpawnOptions } from "node:child_process"
import { createCaffeinationDriver, type CaffeinationDriver } from "../../src/services/caffeination/inhibitor"
import { exec, spawn } from "../../src/util/process"

const READY = "KILO_CAFFEINATION_READY"
const drivers = new Set<CaffeinationDriver>()

function setup(
  platform: NodeJS.Platform,
  script: string | typeof spawn = `console.log('${READY}'); process.stdin.resume()`,
) {
  const calls: { command: string; args: string[]; opts: SpawnOptions; child: ChildProcess }[] = []
  const driver = createCaffeinationDriver({
    platform,
    locate: (name) => name,
    spawn: (command, args, opts = {}) => {
      const child =
        typeof script === "string"
          ? spawn(process.execPath, ["-e", script], { ...opts, stdio: ["pipe", "pipe", "pipe"] })
          : script(command, args, opts)
      calls.push({ command, args, opts, child })
      return child
    },
  })
  drivers.add(driver)
  return {
    driver,
    calls,
    get child() {
      return calls.at(-1)!.child
    },
  }
}

afterEach(async () => {
  await Promise.all([...drivers].map((driver) => driver.stop()))
  drivers.clear()
})

describe("native caffeination drivers", () => {
  it("uses only idle system sleep inhibition on macOS", async () => {
    const fixture = setup("darwin")
    await fixture.driver.start(process.pid, () => {})
    expect(fixture.calls.at(0)?.command).toBe("/usr/bin/caffeinate")
    expect(fixture.calls.at(0)?.args).toEqual(["-i", "-w", String(process.pid)])
    expect(fixture.calls.at(0)?.opts.shell).toBeUndefined()
  })

  it.skipIf(process.platform === "win32")(
    "keeps Linux locking outside the inhibitor and passes the PID as data",
    async () => {
      const fixture = setup("linux", (_command, args, opts) => spawn(args.at(4)!, args.slice(5), opts))
      await fixture.driver.start(process.pid, () => {})
      expect(fixture.calls.at(0)?.command).toBe("systemd-inhibit")
      expect(fixture.calls.at(0)?.args.slice(0, 6)).toEqual([
        "--what=sleep",
        "--who=Kilo Code",
        "--why=Kilo agent running",
        "--mode=block",
        "sh",
        "-c",
      ])
      expect(fixture.calls.at(0)?.args.slice(-2)).toEqual(["kilo-caffeination", String(process.pid)])
      expect(fixture.calls.at(0)?.opts).toMatchObject({ detached: true, stdio: ["ignore", "pipe", "pipe"] })
      await fixture.driver.stop()
      expect(fixture.child.signalCode ?? fixture.child.exitCode).not.toBeNull()
    },
  )

  it.skipIf(process.platform === "win32")("exits the real Linux watcher when its parent exits", async () => {
    const parent = spawn(process.execPath, ["-e", "process.stdin.resume()"], { stdio: ["pipe", "ignore", "ignore"] })
    const ended = Promise.withResolvers<Error | undefined>()
    try {
      await once(parent, "spawn")
      const fixture = setup("linux", (_command, args, opts) => spawn(args.at(4)!, args.slice(5), opts))
      await fixture.driver.start(parent.pid!, ended.resolve)
      const closed = once(parent, "close")
      parent.stdin!.end()
      await closed
      expect((await ended.promise)?.message).toContain("code 0")
      expect(fixture.child.exitCode).toBe(0)
    } finally {
      parent.kill("SIGKILL")
    }
  })

  it("uses an unsigned PowerShell 5.1 mask and acknowledges only after the API succeeds", async () => {
    const fixture = setup("win32")
    await fixture.driver.start(process.pid, () => {})
    const args = fixture.calls.at(0)!.args
    expect(args.slice(0, 6)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command"])
    const script = args.at(-1)!
    expect(script).toContain("$flags = [uint32]2147483649;")
    expect(script).not.toContain("0x80000000")
    expect(script).toContain("$ErrorActionPreference = 'Stop';")
    expect(script).toContain("if ($result -eq 0) { throw 'SetThreadExecutionState failed' }")
    expect(script.indexOf(READY)).toBeGreaterThan(script.indexOf("if ($result -eq 0)"))
    expect(script).toContain("[Console]::Error.WriteLine($_.Exception.Message); exit 1")
    expect(fixture.calls.at(0)?.opts.shell).toBeUndefined()
  })

  it("rejects invalid PIDs before constructing a command", async () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const fixture = setup(platform)
      for (const pid of [0, -1, 1.5, NaN, Infinity, 2_147_483_648, "1; exit 0" as unknown as number]) {
        await expect(fixture.driver.start(pid, () => {})).rejects.toThrow("Invalid parent process ID")
      }
      expect(fixture.calls).toHaveLength(0)
    }
  })

  it("does not spawn for missing tools, unsupported platforms, or an explicit unavailable reason", async () => {
    for (const opts of [{ platform: "linux" as const }, { platform: "freebsd" as const }, { reason: "Remote host" }]) {
      const driver = createCaffeinationDriver({
        ...opts,
        locate: () => undefined,
        spawn: () => {
          throw new Error("Must not spawn")
        },
      })
      expect(driver.available).toBe(false)
      await expect(driver.start(process.pid, () => {})).rejects.toThrow(driver.reason!)
      await driver.stop()
    }
  })

  it("shares pending startup and waits for a complete acknowledgement, not spawn", async () => {
    const fixture = setup(
      "win32",
      `process.stdin.on('data', chunk => { process.stdout.write(chunk); console.error('input') })`,
    )
    let ready = false
    const first = fixture.driver
      .start(process.pid, () => {})
      .then(() => {
        ready = true
      })
    const second = fixture.driver.start(process.pid, () => {})
    await once(fixture.child, "spawn")
    expect(fixture.calls).toHaveLength(1)
    expect(ready).toBe(false)
    const echoed = once(fixture.child.stderr!, "data")
    fixture.child.stdin!.write(`noise\n${READY}`)
    await echoed
    expect(ready).toBe(false)
    fixture.child.stdin!.write("\r\n")
    await Promise.all([first, second])
    expect(ready).toBe(true)
  })

  it("reports a bounded native error and exit code when acquisition fails", async () => {
    const fixture = setup(
      "win32",
      `process.stderr.write('x'.repeat(20000) + 'acquisition denied', () => process.exit(7))`,
    )
    const exits: (Error | undefined)[] = []
    const error = await fixture.driver.start(process.pid, (err) => exits.push(err)).catch((err: Error) => err)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("code 7")
    expect((error as Error).message).toEndWith("acquisition denied")
    expect((error as Error).message.length).toBeLessThan(4_200)
    expect(exits).toHaveLength(0)
    expect(fixture.child.exitCode).toBe(7)
  })

  it("reports spawn errors without retaining a dead child", async () => {
    const fixture = setup("win32", (_command, _args, opts) => spawn("/kilo-missing-inhibitor", [], opts))
    await expect(fixture.driver.start(process.pid, () => {})).rejects.toThrow("ENOENT")
    await fixture.driver.stop()
    await expect(fixture.driver.start(process.pid, () => {})).rejects.toThrow("ENOENT")
    expect(fixture.calls).toHaveLength(2)
  })

  it("reports an unexpected acquired-process exit once with its stderr", async () => {
    const fixture = setup(
      "win32",
      `console.log('${READY}'); process.stdin.once('data', () => process.stderr.write('inhibitor lost', () => process.exit(9)))`,
    )
    const ended = Promise.withResolvers<Error | undefined>()
    const exits: (Error | undefined)[] = []
    await fixture.driver.start(process.pid, (err) => {
      exits.push(err)
      ended.resolve(err)
    })
    fixture.child.stdin!.write("exit")
    expect((await ended.promise)?.message).toContain("code 9: inhibitor lost")
    await fixture.driver.stop()
    expect(exits).toHaveLength(1)
  })

  it("cancels acquisition and makes concurrent stop calls wait for the same exit", async () => {
    const fixture = setup("win32", "process.stdin.resume()")
    const exits: (Error | undefined)[] = []
    const starting = fixture.driver.start(process.pid, (err) => exits.push(err)).catch((err: Error) => err)
    const ended = once(fixture.child, "close")
    const first = fixture.driver.stop()
    expect(fixture.driver.stop()).toBe(first)
    await Promise.all([first, ended])
    expect(await starting).toMatchObject({ message: "The keep-awake process was stopped before starting" })
    expect(fixture.child.signalCode ?? fixture.child.exitCode).not.toBeNull()
    expect(exits).toHaveLength(0)
    await fixture.driver.stop()
  })

  it.skipIf(process.platform === "win32")("escalates and confirms exit before starting a replacement", async () => {
    const fixture = setup("win32", `process.on('SIGTERM', () => {}); console.log('${READY}'); process.stdin.resume()`)
    const exits: (Error | undefined)[] = []
    await fixture.driver.start(process.pid, (err) => exits.push(err))
    const child = fixture.child
    const stopping = fixture.driver.stop()
    const starting = fixture.driver.start(process.pid, (err) => exits.push(err))
    expect(fixture.calls).toHaveLength(1)
    await Promise.all([stopping, starting])
    expect(child.signalCode).toBe("SIGKILL")
    expect(fixture.calls).toHaveLength(2)
    expect(exits).toHaveLength(0)
  })

  it("retains the child for a later stop if signaling fails", async () => {
    const fixture = setup("win32")
    const ended = Promise.withResolvers<Error | undefined>()
    await fixture.driver.start(process.pid, ended.resolve)
    const child = fixture.child
    const kill = child.kill.bind(child)
    child.kill = () => {
      throw new Error("signal denied")
    }
    try {
      child.emit("error", new Error("native failure"))
      expect((await ended.promise)?.message).toContain("native failure: signal denied")
      await expect(fixture.driver.start(process.pid, () => {})).rejects.toThrow("signal denied")
      await expect(fixture.driver.stop()).rejects.toThrow("signal denied")
      expect(fixture.calls).toHaveLength(1)
      child.kill = () => false
      await expect(fixture.driver.stop()).rejects.toThrow("did not exit after SIGKILL")
    } finally {
      child.kill = kill
    }
    await fixture.driver.stop()
    expect(child.signalCode ?? child.exitCode).not.toBeNull()
  })

  it.skipIf(process.platform === "win32")("cleans Linux helpers even after their group leader exits", async () => {
    const script = `process.on('SIGTERM', () => {}); console.error(process.pid); console.log('${READY}'); setInterval(() => {}, 1000)`
    const fixture = setup(
      "linux",
      `Bun.spawn([process.execPath, '-e', ${JSON.stringify(script)}], { stdout: 'inherit', stderr: 'inherit' }); process.stdin.resume()`,
    )
    const starting = fixture.driver.start(process.pid, () => {})
    const [output] = await once(fixture.child.stderr!, "data")
    const pid = Number(String(output).trim())
    expect(Number.isInteger(pid)).toBe(true)
    await starting
    await fixture.driver.stop()
    const status = await exec("ps", ["-p", String(pid), "-o", "stat="]).then(
      (result) => result.stdout.trim(),
      (err: unknown) => {
        if (err instanceof Error && "code" in err && err.code === 1) return ""
        throw err
      },
    )
    expect(status === "" || status.startsWith("Z")).toBe(true)
  })

  it("releases a process that never acknowledges acquisition", async () => {
    const fixture = setup("win32", "process.stdin.resume()")
    await expect(fixture.driver.start(process.pid, () => {})).rejects.toThrow("Timed out while starting")
    expect(fixture.child.signalCode ?? fixture.child.exitCode).not.toBeNull()
  }, 15_000)

  it.skipIf(process.platform !== "win32")(
    "executes the unsigned mask and native failure path in Windows PowerShell",
    async () => {
      for (const result of [1, 0]) {
        const prelude = `$probe = Microsoft.PowerShell.Utility\\Add-Type -TypeDefinition 'public class Probe { public static uint SetThreadExecutionState(uint flags) { if (flags != 2147483649u) throw new System.Exception("wrong flags"); return ${result}u; } }' -PassThru; function Add-Type { $probe }; `
        const fixture = setup("win32", (command, args, opts) =>
          spawn(command, [...args.slice(0, -1), prelude + args.at(-1)], opts),
        )
        if (result === 0) {
          await expect(fixture.driver.start(process.pid, () => {})).rejects.toThrow("SetThreadExecutionState failed")
          continue
        }
        await fixture.driver.start(process.pid, () => {})
        await fixture.driver.stop()
      }
      const fixture = setup("win32", (command, args, opts) =>
        spawn(
          command,
          [...args.slice(0, -1), `function Add-Type { Write-Error 'compilation denied' }; ${args.at(-1)}`],
          opts,
        ),
      )
      await expect(fixture.driver.start(process.pid, () => {})).rejects.toThrow("compilation denied")
    },
    25_000,
  )
})
