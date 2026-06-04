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
    expect(started.state?.port).toBeGreaterThanOrEqual(Daemon.PortRange.start)
    expect(started.state?.port).toBeLessThanOrEqual(Daemon.PortRange.end)

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
