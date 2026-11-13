import { afterAll, expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloLoginService } from "../src/service/login"
import { fakeSupervisor, prependPath } from "./fixtures/login-supervisor"

const entry = path.join(import.meta.dir, "../src/index.ts")
const transpiled = await mkdtemp(path.join(os.tmpdir(), "kilo-service-transpiler-"))
afterAll(() => rm(transpiled, { recursive: true, force: true }))

function hostEnv(root: string, bin: string, extra: Record<string, string> = {}) {
  return prependPath(
    {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      KILO_TEST_HOME: root,
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_STATE_HOME: path.join(root, "state"),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: transpiled,
      BUN_OPTIONS: "",
      ...extra,
    },
    bin,
  )
}

function hostCli(env: Record<string, string | undefined>) {
  const run = async (...args: string[]) => {
    // The package directory, so its bunfig.toml preload compiles the TUI modules the CLI imports (as in
    // packages/cli/test). The service inherits it.
    const child = Bun.spawn([process.execPath, entry, ...args], {
      cwd: path.dirname(import.meta.dir),
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 50_000,
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { code, stdout: stdout.trim(), stderr: stderr.trim() }
  }
  const ok = async (...args: string[]) => {
    const res = await run(...args)
    expect(res.code, res.stderr).toBe(0)
    return res.stdout
  }
  return Object.assign(ok, { run })
}

function freePort() {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  const port = probe.port
  probe.stop(true)
  return port
}

// Service smoke for the host: the host entry runs the upstream `service` commands, the background service it
// spawns is the host again (`serve --service`), and that server has the Kilo plugins. HOME and XDG are isolated.
test("the background service the host starts is the host, with the Kilo plugins", async () => {
  using backend = fixture()
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-host-service-")))
  const sup = await fakeSupervisor(root)
  const cli = hostCli(hostEnv(root, sup.bin, { KILO_API_URL: backend.url }))
  try {
    // A free port, so the test does not meet another service on the default port.
    const port = freePort()
    await cli("service", "set", "port", String(port))

    const url = await cli("service", "start")
    expect(url).toBe(`http://127.0.0.1:${port}`)
    const status = await cli.run("service", "status")
    expect(status).toEqual({ code: 0, stdout: url, stderr: "login: not installed" })

    const authorization = `Basic ${btoa(`opencode:${await cli("service", "get", "password")}`)}`
    // The upstream built-in list has no Kilo plugin, so this also proves the service runs the host entry.
    // The first request boots the location; its plugins activate shortly after.
    const plugins = async (remaining = 100): Promise<unknown[]> => {
      const body = await fetch(new URL(`/api/plugin?location[directory]=${encodeURIComponent(root)}`, url), {
        headers: { authorization },
        signal: AbortSignal.timeout(10_000),
      }).then((response) => response.json())
      if (body.data.length > 0 || remaining === 0) return body.data
      await Bun.sleep(100)
      return plugins(remaining - 1)
    }
    expect(await plugins()).toContainEqual(expect.objectContaining({ id: "kilocode.gateway", source: { type: "sdk" } }))
  } finally {
    await cli("service", "stop").catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

// `daemon` is the Kilo alias of the upstream `service` group: status, stop and restart reach the native service.
test("daemon aliases the service commands", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-host-daemon-")))
  const sup = await fakeSupervisor(root)
  const cli = hostCli(hostEnv(root, sup.bin))
  try {
    const port = freePort()
    await cli("daemon", "set", "port", String(port))
    const url = await cli("daemon", "restart")
    expect(url).toBe(`http://127.0.0.1:${port}`)
    expect(await cli.run("daemon", "status")).toEqual({
      code: 0,
      stdout: url,
      stderr: "login: not installed",
    })
    await cli("daemon", "stop")
    expect(await cli.run("daemon", "status")).toEqual({
      code: 0,
      stdout: "stopped",
      stderr: "login: not installed",
    })
  } finally {
    await cli("daemon", "stop").catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

const unit = KiloLoginService.unit({
  platform: process.platform,
  home: "/tmp",
  log: "/tmp/log",
  config: "/tmp/config",
  uid: process.getuid?.() ?? 0,
  app: "kilo2",
  channel: "local",
})

test.skipIf(unit === undefined)(
  "service install, status, stop and uninstall manage the login unit through the CLI",
  async () => {
    const expected = unit!
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-host-login-")))
    const home = path.join(root, "home")
    await mkdir(home, { recursive: true })
    const sup = await fakeSupervisor(root)
    const cli = hostCli(hostEnv(home, sup.bin))
    try {
      const refused = await cli.run("service", "install")
      expect(refused.code).toBe(1)
      expect(refused.stdout).toBe("")
      expect(Bun.stripANSI(refused.stderr)).toContain("development build")

      const app = path.join(root, "app")
      await mkdir(app, { recursive: true })
      const executable = path.join(app, process.platform === "win32" ? "kilo2.exe" : "kilo2")
      await writeFile(executable, "#!/bin/sh\n", { mode: 0o755 })

      const installed = await cli.run("service", "install", "--command", executable)
      expect(installed).toEqual({
        code: 0,
        stdout: `login: installed (${expected.kind}, ${expected.name}): ${executable} serve --service`,
        stderr: "",
      })

      const calls = await sup.calls()
      if (expected.kind === "launchd") {
        expect(calls.map((call) => call.slice(0, 2))).toEqual([
          ["launchctl", "bootout"],
          ["launchctl", "bootstrap"],
        ])
      }
      if (expected.kind === "systemd") {
        expect(calls).toEqual([
          ["systemctl", "--user", "daemon-reload"],
          ["systemctl", "--user", "enable", "--now", expected.name],
        ])
      }
      if (expected.kind === "schtasks") {
        expect(calls).toEqual([
          [
            "schtasks",
            "/Create",
            "/F",
            "/SC",
            "ONLOGON",
            "/RL",
            "LIMITED",
            "/TN",
            expected.name,
            "/TR",
            `"${executable}" serve --service`,
          ],
          ["schtasks", "/Run", "/TN", expected.name],
        ])
      }

      expect(await cli.run("service", "status")).toEqual({
        code: 0,
        stdout: "stopped",
        stderr: `login: installed (${expected.kind}, ${expected.name})`,
      })

      await rm(executable)
      expect(await cli.run("service", "status")).toEqual({
        code: 0,
        stdout: "stopped",
        stderr: `login: stale (${expected.kind}, ${expected.name}), run \`kilo2 service install\` again`,
      })

      await writeFile(executable, "#!/bin/sh\n", { mode: 0o755 })
      const stopped = await cli.run("service", "stop")
      expect(stopped.code, stopped.stderr).toBe(0)
      if (expected.kind !== "schtasks") {
        expect(stopped.stdout).toBe(`Stopped the login unit (${expected.kind}, ${expected.name})`)
      }
      expect(await cli.run("service", "status")).toEqual({
        code: 0,
        stdout: "stopped",
        stderr: `login: installed (${expected.kind}, ${expected.name})`,
      })

      expect(await cli.run("service", "uninstall")).toEqual({
        code: 0,
        stdout: `login: removed (${expected.kind}, ${expected.name})`,
        stderr: "",
      })
      expect(await cli.run("service", "status")).toEqual({
        code: 0,
        stdout: "stopped",
        stderr: "login: not installed",
      })
      expect(await cli.run("service", "uninstall")).toEqual({
        code: 0,
        stdout: "login: not installed",
        stderr: "",
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  60_000,
)
