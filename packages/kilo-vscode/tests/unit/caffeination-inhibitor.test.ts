import { afterEach, expect, it } from "bun:test"
import { once } from "node:events"
import type { ChildProcess, SpawnOptions } from "node:child_process"
import { createCaffeinationDriver, type CaffeinationDriver } from "../../src/services/caffeination/inhibitor"
import { spawn } from "../../src/util/process"

const READY = "KILO_CAFFEINATION_READY"
const HOLD = "process.stdin.resume()"
const drivers = new Set<CaffeinationDriver>()

function setup(platform: NodeJS.Platform, script: string | typeof spawn = `console.log('${READY}'); ${HOLD}`) {
  const calls: { command: string; args: string[]; opts: SpawnOptions; child: ChildProcess }[] = []
  const ended = Promise.withResolvers<Error | undefined>()
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
    ...driver,
    calls,
    ended: ended.promise,
    start: (pid = process.pid) => driver.start(pid, ended.resolve),
    get child() {
      return calls.at(-1)!.child
    },
  }
}

afterEach(async () => {
  await Promise.all([...drivers].map((driver) => driver.stop()))
  drivers.clear()
})

it.each(
  (
    [
      ["darwin", "/usr/bin/caffeinate", ["-i", "-w", String(process.pid)]],
      ["linux", "systemd-inhibit", ["--what=sleep", "--mode=block", "sh", "-c", String(process.pid)]],
      ["win32", "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command"]],
    ] as const
  ).filter(([platform]) => platform !== "linux" || process.platform !== "win32"),
)("%s uses safe arguments and validates PIDs", async (platform, command, flags) => {
  const run = setup(platform)
  for (const pid of [0, -1, 1.5, NaN, Infinity, 2_147_483_648, "1; exit 0" as unknown as number]) {
    await expect(run.start(pid)).rejects.toThrow("Invalid parent process ID")
  }
  expect(run.calls).toHaveLength(0)
  await run.start()
  const call = run.calls.at(0)!
  expect(call.command).toEndWith(command)
  expect(call.opts).toEqual({ detached: platform === "linux", stdio: ["ignore", "pipe", "pipe"] })
  expect(call.args).toEqual(expect.arrayContaining([...flags]))
  if (platform === "darwin") expect(call.args).toHaveLength(3)
  if (platform === "linux") expect(call.args.filter((arg) => arg.startsWith("--what="))).toEqual(["--what=sleep"])
  if (platform === "win32")
    expect(call.args.at(-1)).toMatch(
      /'Stop'[\s\S]*\[uint32\]2147483649\) -eq 0[\s\S]*throw[\s\S]*KILO_CAFFEINATION_READY[\s\S]*catch.*exit 1/,
    )
})

it.each(["darwin", "linux", "win32", "freebsd", "remote"] as const)(
  "rejects unavailable %s hosts",
  async (platform) => {
    const reason = platform === "remote" ? "Remote host" : undefined
    const driver = createCaffeinationDriver({
      platform: platform === "remote" ? "darwin" : platform,
      reason,
      locate: (name) => (reason ? name : undefined),
    })
    expect(driver.available).toBe(false)
    await expect(driver.start(process.pid, () => {})).rejects.toThrow(reason ?? driver.reason!)
    await driver.stop()
  },
)

it.each([false, true])("shares startup, waits for a full ack, and awaits stop (ack=%s)", async (ack) => {
  const run = setup("win32", "process.stdin.on('data', data => { process.stdout.write(data); console.error('input') })")
  const first = run.start().catch((err: Error) => err)
  const second = run.start().catch((err: Error) => err)
  const echoed = once(run.child.stderr!, "data")
  run.child.stdin!.write(`noise\n${READY}`)
  await echoed
  expect(Bun.peek.status(first)).toBe("pending")
  expect(run.calls).toHaveLength(1)
  if (ack) {
    run.child.stdin!.write("\r\n")
    await Promise.all([first, second])
  }
  const stopping = run.stop()
  expect(run.stop()).toBe(stopping)
  await stopping
  expect(await first).toEqual(
    ack ? undefined : expect.objectContaining({ message: expect.stringContaining("stopped before starting") }),
  )
  expect(Bun.peek.status(run.ended)).toBe("pending")
  expect(run.child.signalCode ?? run.child.exitCode).not.toBeNull()
})

it.each([
  [/ENOENT/, () => spawn("/kilo-missing-inhibitor", [])],
  [
    /code 7: x+acquisition denied$/,
    "process.stderr.write('x'.repeat(20000) + 'acquisition denied', () => process.exit(7))",
  ],
  [/Timed out while starting/, HOLD],
] as const)(
  "bounds errors and cleans up %s",
  async (message, script) => {
    const run = setup("win32", script)
    const error = await run.start().catch((err: Error) => err)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(message)
    expect((error as Error).message.length).toBeLessThan(4_200)
    if (run.child.pid) expect(run.child.signalCode ?? run.child.exitCode).not.toBeNull()
  },
  15_000,
)

it.skipIf(process.platform === "win32")("retains failed cleanup and kills before replacement", async () => {
  const run = setup("win32", `process.on('SIGTERM', () => {}); console.log('${READY}'); ${HOLD}`)
  await run.start()
  const child = run.child
  const kill = child.kill.bind(child)
  child.kill = () => {
    throw new Error("signal denied")
  }
  try {
    child.emit("error", new Error("native failure"))
    expect((await run.ended)?.message).toContain("native failure: signal denied")
    await expect(run.start()).rejects.toThrow("signal denied")
    child.kill = () => false
    await expect(run.stop()).rejects.toThrow("did not exit after SIGKILL")
  } finally {
    child.kill = kill
  }
  const stopping = run.stop()
  const starting = run.start()
  expect(run.calls).toHaveLength(1)
  await Promise.all([stopping, starting])
  expect(child.signalCode).toBe("SIGKILL")
  expect(run.calls).toHaveLength(2)
})

it.skipIf(process.platform === "win32")("ends the real Linux watcher on parent exit", async () => {
  const parent = setup("win32")
  await parent.start()
  const run = setup("linux", (_command, args, opts) => spawn(args.at(4)!, args.slice(5), opts))
  await run.start(parent.child.pid!)
  await parent.stop()
  expect((await run.ended)?.message).toContain("code 0")
  expect(run.child.exitCode).toBe(0)
})

it.skipIf(process.platform === "win32")("kills Linux helpers after their group leader exits", async () => {
  const script = `process.on('SIGTERM', () => {}); console.error(process.pid); console.log('${READY}'); setInterval(() => {}, 1000)`
  const run = setup(
    "linux",
    `Bun.spawn([process.execPath, '-e', ${JSON.stringify(script)}], { stdout: 'inherit', stderr: 'inherit' }); ${HOLD}`,
  )
  const starting = run.start()
  const [output] = await once(run.child.stderr!, "data")
  const pid = Number(String(output).trim())
  expect(Number.isInteger(pid)).toBe(true)
  await starting
  await run.stop()
  const status = Bun.spawnSync(["ps", "-p", String(pid), "-o", "stat="])
  expect([0, 1]).toContain(status.exitCode)
  expect(status.stdout.toString().trim()).toMatch(/^Z|^$/)
})

it.skipIf(process.platform !== "win32")(
  "checks native PowerShell acquisition",
  async () => {
    for (const result of [1, 0, "error"] as const) {
      const prelude =
        result === "error"
          ? "function Add-Type { Write-Error 'compilation denied' }; "
          : `$probe = Microsoft.PowerShell.Utility\\Add-Type -TypeDefinition 'public class Probe { public static uint SetThreadExecutionState(uint flags) { if (flags != 2147483649u) throw new System.Exception("wrong flags"); return ${result}u; } }' -PassThru; function Add-Type { $probe }; `
      const run = setup("win32", (command, args, opts) =>
        spawn(command, [...args.slice(0, -1), prelude + args.at(-1)], opts),
      )
      const starting = run.start()
      if (result === 1) await starting
      if (result !== 1)
        await expect(starting).rejects.toThrow(result === 0 ? "SetThreadExecutionState failed" : "compilation denied")
      await run.stop()
    }
  },
  25_000,
)
