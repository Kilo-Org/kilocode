import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Daemon } from "../../src/kilocode/daemon/daemon"
import { DaemonClient } from "../../src/kilocode/daemon/client"
import { tmpdir } from "../fixture/fixture"

const original = {
  state: process.env.KILO_TEST_DAEMON_STATE_DIR,
  log: process.env.KILO_TEST_DAEMON_LOG_DIR,
  disabled: process.env.KILO_NO_DAEMON,
}

afterEach(async () => {
  if (process.env.KILO_TEST_DAEMON_STATE_DIR !== original.state) await Daemon.stop().catch(() => undefined)
  restore()
})

function restore() {
  if (original.state === undefined) delete process.env.KILO_TEST_DAEMON_STATE_DIR
  else process.env.KILO_TEST_DAEMON_STATE_DIR = original.state
  if (original.log === undefined) delete process.env.KILO_TEST_DAEMON_LOG_DIR
  else process.env.KILO_TEST_DAEMON_LOG_DIR = original.log
  if (original.disabled === undefined) delete process.env.KILO_NO_DAEMON
  else process.env.KILO_NO_DAEMON = original.disabled
}

function dirs(root: string) {
  process.env.KILO_TEST_DAEMON_STATE_DIR = path.join(root, "state")
  process.env.KILO_TEST_DAEMON_LOG_DIR = path.join(root, "log")
  return {
    XDG_DATA_HOME: path.join(root, "xdg-data"),
    XDG_CONFIG_HOME: path.join(root, "xdg-config"),
    XDG_STATE_HOME: path.join(root, "xdg-state"),
    XDG_CACHE_HOME: path.join(root, "xdg-cache"),
    KILO_TEST_DAEMON_EPHEMERAL_PORT: "1",
  }
}

function opts(root: string): Daemon.Options {
  return {
    hostname: "127.0.0.1",
    port: 0,
    mdns: false,
    mdnsDomain: "kilo.local",
    cors: [],
    command: [process.execPath, "--conditions=browser", path.join(process.cwd(), "src/index.ts")],
    env: dirs(root),
    timeout: 20_000,
  }
}

function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return Bun.spawn([process.execPath, "--conditions=browser", path.join(process.cwd(), "src/index.ts"), ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      KILO_CONFIG_CONTENT: '{"experimental":{"openTelemetry":false}}',
      KILO_DISABLE_PROJECT_CONFIG: "1",
      KILO_DISABLE_AUTOUPDATE: "1",
      KILO_DISABLE_MODELS_FETCH: "1",
      KILO_AUTH_CONTENT: "{}",
      KILO_PURE: "1",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
}

function capture(stream: ReadableStream<Uint8Array>, match: string) {
  const ready = Promise.withResolvers<void>()
  const text = (async () => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const chunks: string[] = []
    while (true) {
      const part = await reader.read()
      if (part.done) break
      chunks.push(decoder.decode(part.value, { stream: true }))
      if (chunks.join("").includes(match)) ready.resolve()
    }
    chunks.push(decoder.decode())
    return chunks.join("")
  })()
  return { ready: ready.promise, text }
}

async function deadline<T>(promise: Promise<T>, timeout: number) {
  const expired = Symbol("expired")
  const result = await Promise.race([promise, Bun.sleep(timeout).then(() => expired)])
  if (result === expired) throw new Error(`Timed out after ${timeout}ms`)
  return result
}

describe("daemon manager", () => {
  test("reports not running without daemon state", async () => {
    await using tmp = await tmpdir()
    dirs(tmp.path)

    const status = await Daemon.status()

    expect(status.running).toBe(false)
    expect(status.stale).toBe(false)
    expect(status.reason).toBe("not running")
  })

  test("strips inherited cwd flags from daemon child command", () => {
    expect(Daemon.clean(["--conditions=browser", "--cwd", "packages/opencode", "--inspect"])).toStrictEqual([
      "--conditions=browser",
      "--inspect",
    ])
    expect(Daemon.clean(["--cwd=packages/opencode", "--conditions=browser"])).toStrictEqual(["--conditions=browser"])
  })

  test("does not forward bundled bun entrypoints to the daemon child", () => {
    const proc = {
      argv: ["/tmp/kilo", "/$bunfs/root/src/index.js", "daemon", "start"],
      execArgv: ["--user-agent=kilo/test", "--use-system-ca", "--"],
      execPath: "/tmp/kilo",
    }
    expect(Daemon.command(undefined, proc)).toStrictEqual(["/tmp/kilo"])
    expect(
      Daemon.command(undefined, {
        ...proc,
        argv: ["C:/tmp/kilo.exe", "B:/~BUN/root/src/index.js", "daemon", "start"],
        execPath: "C:/tmp/kilo.exe",
      }),
    ).toStrictEqual(["C:/tmp/kilo.exe"])
    expect(
      Daemon.command(undefined, {
        ...proc,
        argv: ["C:/tmp/kilo.exe", "b:\\~BUN\\root\\src\\index.js", "daemon", "start"],
        execPath: "C:/tmp/kilo.exe",
      }),
    ).toStrictEqual(["C:/tmp/kilo.exe"])
  })

  test("forwards source entrypoints to the daemon child", () => {
    expect(
      Daemon.command(undefined, {
        argv: ["/tmp/bun", "/tmp/kilo/src/index.ts", "daemon", "start"],
        execArgv: ["--conditions=browser"],
        execPath: "/tmp/bun",
      }),
    ).toStrictEqual(["/tmp/bun", "--conditions=browser", "/tmp/kilo/src/index.ts"])
  })

  test("reuses one daemon across caller directories", async () => {
    await using tmp = await tmpdir()
    const env = opts(tmp.path)
    const first = await Daemon.start(env)
    const cwd = process.cwd()
    try {
      process.chdir(path.dirname(tmp.path))
      const second = await Daemon.start(env)
      expect(second.reused).toBe(true)
      expect(second.state?.pid).toBe(first.state?.pid)
    } finally {
      process.chdir(cwd)
    }
  }, 20_000)

  test("starts, reuses, authenticates, and stops a daemon", async () => {
    await using tmp = await tmpdir()

    const started = await Daemon.start(opts(tmp.path))
    expect(started.started).toBe(true)
    expect(started.running).toBe(true)
    expect(started.state?.pid).toBeGreaterThan(0)
    expect(started.state?.token).toBeTruthy()
    expect(started.state?.port).toBeGreaterThan(0)

    const blocked = await fetch(`${started.state!.url}/config?directory=${encodeURIComponent(tmp.path)}`)
    expect(blocked.status).toBe(401)

    const config = await fetch(`${started.state!.url}/config?directory=${encodeURIComponent(tmp.path)}`, {
      headers: { authorization: `Basic ${started.state!.token}` },
    })
    expect(config.status).toBe(200)

    const health = await fetch(`${started.state!.url}/global/health`, {
      headers: { authorization: `Basic ${started.state!.token}` },
    })
    expect(health.status).toBe(200)

    const reused = await Daemon.start(opts(tmp.path))
    expect(reused.reused).toBe(true)
    expect(reused.state?.pid).toBe(started.state?.pid)

    const stopped = await Daemon.stop()
    expect(stopped.stopped).toBe(true)
    expect((await Daemon.status()).running).toBe(false)

    const again = await Daemon.start(opts(tmp.path))
    expect(again.running).toBe(true)
    const restarted = await fetch(`${again.state!.url}/global/health`, {
      headers: { authorization: `Basic ${again.state!.token}` },
    })
    expect(restarted.status).toBe(200)
  }, 20_000)

  test("does not let a foreground owner stop a replacement daemon", async () => {
    await using tmp = await tmpdir()
    const input = opts(tmp.path)
    const first = await Daemon.start(input)
    const state = first.state
    if (!state) throw new Error("Daemon did not provide process state")
    const waiting = Daemon.foreground(async () => state)

    const second = await Daemon.restart(input)
    await deadline(waiting, 5_000)
    const stopped = await Daemon.stop(state)
    const current = await Daemon.status()

    expect(stopped.stopped).toBe(false)
    expect(current.running).toBe(true)
    expect(current.state?.pid).toBe(second.state?.pid)
    expect(current.state?.pid).not.toBe(state.pid)
  }, 30_000)

  test.skipIf(process.platform === "win32")(
    "records foreground interrupts while startup is pending",
    async () => {
      await using tmp = await tmpdir()
      const input = opts(tmp.path)
      await Daemon.start(input)
      const ready = path.join(tmp.path, "foreground-ready")
      const release = path.join(tmp.path, "foreground-release")
      const source = path.join(process.cwd(), "src/kilocode/daemon/daemon.ts")
      const script = `
        import { Daemon } from ${JSON.stringify(source)}
        await Daemon.foreground(async () => {
          await Bun.write(${JSON.stringify(ready)}, "ready")
          while (!(await Bun.file(${JSON.stringify(release)}).exists())) await Bun.sleep(10)
          const state = await Daemon.read()
          if (!state) throw new Error("Daemon did not provide process state")
          return state
        })
      `
      const proc = Bun.spawn([process.execPath, "--conditions=browser", "-e", script], {
        cwd: process.cwd(),
        env: { ...process.env, ...input.env },
        stdout: "pipe",
        stderr: "pipe",
      })
      const stdout = new Response(proc.stdout).text()
      const stderr = new Response(proc.stderr).text()

      try {
        await deadline(
          (async () => {
            while (!(await Bun.file(ready).exists())) await Bun.sleep(10)
          })(),
          5_000,
        )
        proc.kill("SIGINT")
        await Bun.write(release, "release")
        expect(await deadline(proc.exited, 10_000)).toBe(0)
        expect((await Daemon.status()).running).toBe(false)
        await Promise.all([stdout, stderr])
      } finally {
        if (proc.exitCode === null) proc.kill("SIGKILL")
        await proc.exited
        await Daemon.stop()
      }
    },
    25_000,
  )

  test("supports console stop as a daemon stop alias", async () => {
    await using tmp = await tmpdir()
    const input = opts(tmp.path)
    await Daemon.start(input)
    const proc = cli(["console", "stop"], input.env)
    const [code, stdout, stderr] = await Promise.all([
      deadline(proc.exited, 20_000),
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    expect(code).toBe(0)
    expect(stdout).toContain("kilo daemon stopped")
    expect(stderr).not.toContain("Could not open browser automatically")
    expect((await Daemon.status()).running).toBe(false)
  }, 30_000)

  test.skipIf(process.platform === "win32")(
    "stops a foreground daemon on SIGINT",
    async () => {
      await using tmp = await tmpdir()
      const env = dirs(tmp.path)
      const proc = cli(["daemon", "-f", "--port", "0"], env)
      const stdout = capture(proc.stdout, "Press Ctrl+C to stop the Kilo daemon.")
      const stderr = new Response(proc.stderr).text()

      try {
        await deadline(
          Promise.race([
            stdout.ready,
            stdout.text.then(() => {
              throw new Error("Foreground daemon exited before becoming ready")
            }),
          ]),
          20_000,
        )
        const state = await Daemon.status()
        expect(state.running).toBe(true)
        expect(proc.exitCode).toBeNull()

        proc.kill("SIGINT")
        expect(await deadline(proc.exited, 10_000)).toBe(0)
        expect((await Daemon.status()).running).toBe(false)
        expect(await stdout.text).toContain("kilo daemon started")
        await stderr
      } finally {
        if (proc.exitCode === null) proc.kill("SIGKILL")
        await proc.exited
        await Daemon.stop()
      }
    },
    35_000,
  )

  test("daemon client does not start a daemon while attaching", async () => {
    await using tmp = await tmpdir()
    dirs(tmp.path)

    const daemon = await DaemonClient.connect()

    expect(daemon).toBeUndefined()
    expect((await Daemon.status()).running).toBe(false)
  })

  test("daemon client honors the escape hatch", async () => {
    await using tmp = await tmpdir()
    const started = await Daemon.start(opts(tmp.path))
    process.env.KILO_NO_DAEMON = "1"

    const daemon = await DaemonClient.connect()

    expect(daemon).toBeUndefined()
    expect((await Daemon.status()).state?.pid).toBe(started.state?.pid)
  }, 20_000)

  test("daemon client returns authenticated attach settings", async () => {
    await using tmp = await tmpdir()
    const started = await Daemon.start(opts(tmp.path))

    const daemon = await DaemonClient.connect()

    expect(daemon?.url).toBe(started.state?.url)
    expect(daemon?.headers.Authorization).toBe(`Basic ${daemon?.state.token}`)
  }, 20_000)
})
