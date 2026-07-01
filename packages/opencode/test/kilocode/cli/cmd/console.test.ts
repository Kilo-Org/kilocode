import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "fs"
import os from "os"
import path from "path"
import { explicitNetworkOptions } from "../../../../src/cli/network"
import { getNetworkIPs, serverUrls } from "../../../../src/kilocode/cli/server-urls"
import { Systemd } from "../../../../src/kilocode/cli/systemd"
import { __test__, systemctlRunner } from "../../../../src/kilocode/cli/cmd/console"
import { Daemon } from "../../../../src/kilocode/daemon/daemon"

function opts(input: Partial<Daemon.Network> = {}): Daemon.Options {
  return {
    hostname: "127.0.0.1",
    port: 4097,
    mdns: false,
    mdnsDomain: "kilo.local",
    cors: [],
    ...input,
  }
}

function state(input: Partial<Daemon.Network> = {}) {
  const options = Daemon.Network.parse(opts(input))
  return Daemon.State.parse({
    pid: 1,
    hostname: options.hostname,
    port: options.port,
    url: `http://${options.hostname}:${options.port}`,
    username: "kilo",
    password: "kilo",
    token: "token",
    version: "test",
    startedAt: new Date(0).toISOString(),
    log: "/tmp/daemon.log",
    options,
  })
}

describe("server URL display", () => {
  test("advertises a network URL only for wildcard binds", () => {
    expect(serverUrls("127.0.0.1", 4096)).toStrictEqual({
      local: "http://127.0.0.1:4096",
      network: undefined,
      bind: "http://127.0.0.1:4096",
    })
    expect(serverUrls("192.168.1.50", 4096)).toStrictEqual({
      local: "http://192.168.1.50:4096",
      network: undefined,
      bind: "http://192.168.1.50:4096",
    })

    const ip = getNetworkIPs()[0]
    expect(serverUrls("0.0.0.0", 4096)).toStrictEqual({
      local: "http://localhost:4096",
      network: ip ? `http://${ip}:4096` : undefined,
      bind: "http://0.0.0.0:4096",
    })
  })

  test("formats IPv6 bind URLs without advertising IPv4 interfaces", () => {
    expect(serverUrls("::1", 4096)).toStrictEqual({
      local: "http://[::1]:4096",
      network: undefined,
      bind: "http://[::1]:4096",
    })
    expect(serverUrls("::", 4096)).toStrictEqual({
      local: "http://[::1]:4096",
      network: undefined,
      bind: "http://[::]:4096",
    })
  })
})

describe("console daemon startup", () => {
  test("detects every explicit network option form", () => {
    expect(
      explicitNetworkOptions([
        "kilo",
        "console",
        "--port=4321",
        "--hostname",
        "0.0.0.0",
        "--no-mdns",
        "--mdns-domain=test.local",
        "--cors",
        "https://example.com",
      ]),
    ).toStrictEqual(["port", "hostname", "mdns", "mdnsDomain", "cors"])
    expect(explicitNetworkOptions(["kilo", "console", "--", "--port=4321"])).toStrictEqual([])
  })

  test("matches every explicit network option", () => {
    const current = state({ mdns: true, cors: ["https://b.example", "https://a.example"] })
    const input = opts({
      port: current.port,
      mdns: true,
      cors: ["https://a.example", "https://b.example", "https://a.example"],
    })

    expect(Daemon.matches(current, input, ["port", "hostname", "mdns", "mdnsDomain", "cors"])).toBe(true)
  })

  test("treats an explicit auto port as compatible", () => {
    expect(Daemon.matches(state(), opts({ port: 0 }), ["port"])).toBe(true)
  })

  test("supports daemon state written before network options were persisted", () => {
    const current = { ...state(), options: undefined }

    expect(Daemon.matches(current, opts(), ["hostname", "port"])).toBe(true)
    expect(Daemon.matches(current, opts(), ["mdns"])).toBe(false)
    expect(Daemon.matches(current, opts(), ["mdnsDomain"])).toBe(false)
    expect(Daemon.matches(current, opts(), ["cors"])).toBe(false)
  })

  test("rejects each mismatched explicit network option", () => {
    const current = state()

    expect(Daemon.matches(current, opts({ hostname: "0.0.0.0" }), ["hostname"])).toBe(false)
    expect(Daemon.matches(current, opts({ port: current.port + 1 }), ["port"])).toBe(false)
    expect(Daemon.matches(current, opts({ mdns: true }), ["mdns"])).toBe(false)
    expect(Daemon.matches(current, opts({ mdnsDomain: "test.local" }), ["mdnsDomain"])).toBe(false)
    expect(Daemon.matches(current, opts({ cors: ["https://example.com"] }), ["cors"])).toBe(false)

    const mdns = state({ mdns: true })
    expect(Daemon.matches(mdns, opts({ hostname: "0.0.0.0", mdns: true }), ["mdns"])).toBe(false)
  })
})

describe("console systemd subcommands", () => {
  test("install bails out when systemd is unavailable", async () => {
    const originalIsAvailable = Systemd.isAvailable
    const originalExitCode = process.exitCode
    ;(Systemd as { isAvailable: () => boolean }).isAvailable = () => false
    process.exitCode = 0
    try {
      await __test__.InstallCommand.handler({
        hostname: "127.0.0.1",
        port: 4097,
        mdns: false,
        "mdns-domain": "kilo.local",
        cors: [],
        "unit-name": "kilo-console.service",
        system: false,
        "--": [],
      } as never)
      expect(process.exitCode).toBe(1)
    } finally {
      ;(Systemd as { isAvailable: () => boolean }).isAvailable = originalIsAvailable
      process.exitCode = originalExitCode
    }
  })

  test("install rejects --system when not running as root", async () => {
    const prevIsAvailable = Systemd.isAvailable
    const prevEuid = Object.getOwnPropertyDescriptor(process, "geteuid")
    ;(Systemd as { isAvailable: () => boolean }).isAvailable = () => true
    if (!("geteuid" in process)) {
      Object.defineProperty(process, "geteuid", { value: () => 1000, configurable: true })
    }
    try {
      await expect(
        __test__.InstallCommand.handler({
          hostname: "127.0.0.1",
          port: 4097,
          mdns: false,
          "mdns-domain": "kilo.local",
          cors: [],
          "unit-name": "kilo-console.service",
          system: true,
          "--": [],
        } as never),
      ).rejects.toThrow(/requires root/)
    } finally {
      ;(Systemd as { isAvailable: () => boolean }).isAvailable = prevIsAvailable
      if (prevEuid) Object.defineProperty(process, "geteuid", prevEuid)
    }
  })

  test("install rejects an invalid --unit-name", async () => {
    const prevIsAvailable = Systemd.isAvailable
    ;(Systemd as { isAvailable: () => boolean }).isAvailable = () => true
    try {
      await expect(
        __test__.InstallCommand.handler({
          hostname: "127.0.0.1",
          port: 4097,
          mdns: false,
          "mdns-domain": "kilo.local",
          cors: [],
          "unit-name": "../etc/passwd",
          system: false,
          "--": [],
        } as never),
      ).rejects.toThrow(/invalid --unit-name/)
    } finally {
      ;(Systemd as { isAvailable: () => boolean }).isAvailable = prevIsAvailable
    }
  })

  test("install rejects a non-http(s) --cors origin", async () => {
    const prevIsAvailable = Systemd.isAvailable
    ;(Systemd as { isAvailable: () => boolean }).isAvailable = () => true
    try {
      await expect(
        __test__.InstallCommand.handler({
          hostname: "127.0.0.1",
          port: 4097,
          mdns: false,
          "mdns-domain": "kilo.local",
          cors: ["javascript:alert(1)"],
          "unit-name": "kilo-console.service",
          system: false,
          "--": [],
        } as never),
      ).rejects.toThrow(/invalid --cors/)
    } finally {
      ;(Systemd as { isAvailable: () => boolean }).isAvailable = prevIsAvailable
    }
  })

  test("install writes a unit file with the expected ExecStart and runs systemctl", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "kilo-console-install-"))
    const prevXdg = process.env.XDG_CONFIG_HOME
    const prevExec = Object.getOwnPropertyDescriptor(process, "execPath")
    const prevArgv = process.argv
    const prevIsAvailable = Systemd.isAvailable
    const prevRun = systemctlRunner.current
    const calls: { cmd: string[]; scope: "user" | "system" }[] = []
    process.env.XDG_CONFIG_HOME = tmp
    Object.defineProperty(process, "execPath", { value: "/usr/local/bin/kilo", configurable: true })
    process.argv = ["node", "/usr/local/bin/kilo"]
    ;(Systemd as { isAvailable: () => boolean }).isAvailable = () => true
    systemctlRunner.current = async (cmd, scope = "user") => {
      calls.push({ cmd, scope })
      return { code: 0, stdout: "", stderr: "" }
    }
    try {
      await __test__.InstallCommand.handler({
        hostname: "0.0.0.0",
        port: 4097,
        mdns: true,
        "mdns-domain": "kilo.local",
        cors: ["https://a.example", "https://b.example"],
        "unit-name": "kilo-console.service",
        system: false,
        "--": ["--mdns"],
      } as never)

      const unitPath = path.join(tmp, "systemd", "user", "kilo-console.service")
      const unit = readFileSync(unitPath, "utf8")
      expect(unit).toContain("ExecStart=/usr/local/bin/kilo console --foreground")
      expect(unit).toContain("--hostname 0.0.0.0")
      expect(unit).toContain("--port 4097")
      expect(unit).toContain("--mdns")
      expect(unit).toContain("--cors https://a.example")
      expect(unit).toContain("--cors https://b.example")
      expect(unit).toContain("--mdns-domain kilo.local")
      expect(unit).toContain("WantedBy=default.target")
      expect(unit).toContain("Type=simple")

      expect(calls).toContainEqual({ cmd: ["daemon-reload"], scope: "user" })
      expect(calls).toContainEqual({
        cmd: ["enable", "kilo-console.service"],
        scope: "user",
      })
      expect(calls).toContainEqual({
        cmd: ["start", "kilo-console.service"],
        scope: "user",
      })
    } finally {
      systemctlRunner.current = prevRun
      ;(Systemd as { isAvailable: () => boolean }).isAvailable = prevIsAvailable
      process.argv = prevArgv
      Object.defineProperty(process, "execPath", prevExec!)
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = prevXdg
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("install uses the host node + real entry script when invoked via a shim", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "kilo-console-install-node-"))
    const prevXdg = process.env.XDG_CONFIG_HOME
    const prevExec = Object.getOwnPropertyDescriptor(process, "execPath")
    const prevArgv = process.argv
    const prevIsAvailable = Systemd.isAvailable
    process.env.XDG_CONFIG_HOME = tmp
    Object.defineProperty(process, "execPath", {
      value: "/home/user/.nvm/versions/node/v26.3.0/bin/node",
      configurable: true,
    })
    process.argv = [
      "node",
      "/home/user/.local/share/pnpm/global/v11/pkg/node_modules/@kilocode/cli/bin/kilo",
    ]
    ;(Systemd as { isAvailable: () => boolean }).isAvailable = () => true
    systemctlRunner.current = async () => ({ code: 0, stdout: "", stderr: "" })
    try {
      await __test__.InstallCommand.handler({
        hostname: "127.0.0.1",
        port: 4097,
        mdns: false,
        "mdns-domain": "kilo.local",
        cors: [],
        "unit-name": "kilo-console.service",
        system: false,
        "--": [],
      } as never)

      const unit = readFileSync(
        path.join(tmp, "systemd", "user", "kilo-console.service"),
        "utf8",
      )
      expect(unit).toContain(
        "ExecStart=/home/user/.nvm/versions/node/v26.3.0/bin/node /home/user/.local/share/pnpm/global/v11/pkg/node_modules/@kilocode/cli/bin/kilo console --foreground",
      )
      expect(unit).not.toContain("pnpm/bin/kilo console")
    } finally {
      ;(Systemd as { isAvailable: () => boolean }).isAvailable = prevIsAvailable
      process.argv = prevArgv
      Object.defineProperty(process, "execPath", prevExec!)
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = prevXdg
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("install toggles user/system unit paths via the --system flag", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "kilo-console-scope-"))
    const prevXdg = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = tmp
    try {
      const user = Systemd.userUnitPath("kilo-console.service")
      expect(user).toBe(path.join(tmp, "systemd", "user", "kilo-console.service"))
      expect(Systemd.systemUnitPath("kilo-console.service")).toBe(
        path.join("/etc/systemd/system", "kilo-console.service"),
      )
      expect(Systemd.unitScope({ system: true })).toBe("system")
      expect(Systemd.unitScope({ system: false })).toBe("user")
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = prevXdg
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("uninstall reports not-installed when the unit file is missing", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "kilo-console-uninstall-"))
    const prevXdg = process.env.XDG_CONFIG_HOME
    const prevIsAvailable = Systemd.isAvailable
    const prevRun = systemctlRunner.current
    const calls: { cmd: string[]; scope: "user" | "system" }[] = []
    process.env.XDG_CONFIG_HOME = tmp
    ;(Systemd as { isAvailable: () => boolean }).isAvailable = () => true
    systemctlRunner.current = async (cmd, scope = "user") => {
      calls.push({ cmd, scope })
      return { code: 0, stdout: "", stderr: "" }
    }
    try {
      await __test__.UninstallCommand.handler({
        "unit-name": "kilo-console.service",
        system: false,
      } as never)
      expect(calls).toEqual([])
    } finally {
      systemctlRunner.current = prevRun
      ;(Systemd as { isAvailable: () => boolean }).isAvailable = prevIsAvailable
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = prevXdg
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("uninstall proceeds past a hung systemctl stop via the timeout", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "kilo-console-uninstall-hung-"))
    const unitPath = path.join(tmp, "systemd", "user", "kilo-console.service")
    await Bun.write(unitPath, "[Unit]\n")
    const prevXdg = process.env.XDG_CONFIG_HOME
    const prevIsAvailable = Systemd.isAvailable
    const prevRun = systemctlRunner.current
    const prevStopTimeout = __test__.stopTimeout.current
    const calls: string[][] = []
    process.env.XDG_CONFIG_HOME = tmp
    ;(Systemd as { isAvailable: () => boolean }).isAvailable = () => true
    __test__.stopTimeout.current = 50
    systemctlRunner.current = async (cmd) => {
      calls.push(cmd)
      if (cmd[0] === "stop") {
        return new Promise((resolve) =>
          setTimeout(() => resolve({ code: 0, stdout: "", stderr: "" }), 10_000),
        )
      }
      return { code: 0, stdout: "", stderr: "" }
    }
    const original = console.warn
    const warnings: string[] = []
    console.warn = (msg: string) => warnings.push(msg)
    try {
      await __test__.UninstallCommand.handler({
        "unit-name": "kilo-console.service",
        system: false,
      } as never)
      expect(calls).toContainEqual(["stop", "kilo-console.service"])
      expect(calls).toContainEqual(["disable", "kilo-console.service"])
      expect(calls).toContainEqual(["daemon-reload"])
      expect(warnings.some((w) => /stop: no/.test(w))).toBe(true)
    } finally {
      console.warn = original
      __test__.stopTimeout.current = prevStopTimeout
      systemctlRunner.current = prevRun
      ;(Systemd as { isAvailable: () => boolean }).isAvailable = prevIsAvailable
      if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = prevXdg
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("enable runs systemctl enable in the requested scope", async () => {
    const prevIsAvailable = Systemd.isAvailable
    const prevRun = systemctlRunner.current
    const calls: { cmd: string[]; scope: "user" | "system" }[] = []
    ;(Systemd as { isAvailable: () => boolean }).isAvailable = () => true
    systemctlRunner.current = async (cmd, scope = "user") => {
      calls.push({ cmd, scope })
      return { code: 0, stdout: "", stderr: "" }
    }
    try {
      await __test__.EnableCommand.handler({
        "unit-name": "kilo-console.service",
        system: true,
      } as never)
      expect(calls).toEqual([{ cmd: ["enable", "kilo-console.service"], scope: "system" }])
    } finally {
      systemctlRunner.current = prevRun
      ;(Systemd as { isAvailable: () => boolean }).isAvailable = prevIsAvailable
    }
  })

  test("is-enabled surfaces systemctl exit code via process.exitCode", async () => {
    const prevIsAvailable = Systemd.isAvailable
    const prevExitCode = process.exitCode
    const prevRun = systemctlRunner.current
    ;(Systemd as { isAvailable: () => boolean }).isAvailable = () => true
    systemctlRunner.current = async () => ({ code: 1, stdout: "", stderr: "disabled\n" })
    process.exitCode = 0
    try {
      await __test__.IsEnabledCommand.handler({
        "unit-name": "kilo-console.service",
        system: false,
      } as never)
      expect(process.exitCode).toBe(1)
    } finally {
      systemctlRunner.current = prevRun
      ;(Systemd as { isAvailable: () => boolean }).isAvailable = prevIsAvailable
      process.exitCode = prevExitCode
    }
  })
})
