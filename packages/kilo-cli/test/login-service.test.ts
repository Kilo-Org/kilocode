import { NodeFileSystem } from "@effect/platform-node"
import { expect, test } from "bun:test"
import { Effect, FileSystem } from "effect"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloLoginService } from "../src/service/login"

const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  )

/** Records every command and answers from `exitCodes` and `stdout`, keyed by full command or first argument. */
function recorder(exitCodes: Record<string, number> = {}, stdout: Record<string, string> = {}) {
  const calls: string[][] = []
  const run: KiloLoginService.Run = (command, args) =>
    Effect.sync(() => {
      calls.push([command, ...args])
      const full = `${command} ${args.join(" ")}`
      const head = `${command} ${args.at(0) ?? ""}`
      return {
        exitCode: exitCodes[full] ?? exitCodes[head] ?? 0,
        stdout: stdout[full] ?? stdout[head] ?? "",
        stderr: "denied by policy\n",
      }
    })
  return { calls, run }
}

async function withHome<A>(body: (target: KiloLoginService.Target) => Promise<A>, platform: NodeJS.Platform) {
  const home = await mkdtemp(path.join(os.tmpdir(), "kilo-login-"))
  try {
    return await body({
      platform,
      home,
      log: path.join(home, "log"),
      config: path.join(home, ".config"),
      uid: 501,
      app: "kilo2",
      channel: "latest",
    })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

const provided = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.runPromise(Effect.provide(effect, NodeFileSystem.layer))

const command = ["/opt/kilo/bin/kilo", "serve", "--service"]

test("names the unit per platform, app directory and channel", async () => {
  await withHome(async (target) => {
    expect(KiloLoginService.unit(target)).toMatchObject({ kind: "launchd", name: "ai.kilo.kilo2.latest" })
    expect(KiloLoginService.unit({ ...target, platform: "linux" })).toMatchObject({
      kind: "systemd",
      name: "kilo2-latest.service",
    })
    expect(KiloLoginService.unit({ ...target, platform: "win32" })).toMatchObject({
      kind: "schtasks",
      name: "Kilo kilo2 latest",
    })
    expect(KiloLoginService.unit({ ...target, channel: "feat/x y" })?.name).toBe("ai.kilo.kilo2.feat-x-y")
    expect(KiloLoginService.unit({ ...target, platform: "aix" })).toBeUndefined()
  }, "darwin")
})

test("the launchd agent runs the server at login, restarts it only after a crash, and keeps PATH", () => {
  const plist = KiloLoginService.plist({
    label: "ai.kilo.kilo2.latest",
    command: ["/Users/a&b/kilo", "serve", "--service"],
    path: "/opt/homebrew/bin:/usr/bin",
    home: "/Users/a&b",
    log: "/Users/a&b/log",
  })
  expect(plist).toContain("<string>/Users/a&amp;b/kilo</string>\n    <string>serve</string>\n    <string>--service</string>")
  expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>")
  expect(plist).toContain("<key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>")
  expect(plist).toContain("<key>PATH</key>\n    <string>/opt/homebrew/bin:/usr/bin</string>")
  expect(plist).toContain("<key>WorkingDirectory</key>\n  <string>/Users/a&amp;b</string>")
  expect(plist).toContain("<key>StandardOutPath</key>\n  <string>/Users/a&amp;b/log/ai.kilo.kilo2.latest.log</string>")
  expect(plist).not.toContain("a&b")
  // A plist is macOS text even when the value is built on another host for tests.
  expect(
    KiloLoginService.plist({
      label: "ai.kilo.kilo2.latest",
      command: ["C:\\Kilo\\kilo.exe", "serve", "--service"],
      path: undefined,
      home: "C:\\Users\\me",
      log: "C:\\Kilo\\log\\",
    }),
  ).toContain("<string>C:/Kilo/log/ai.kilo.kilo2.latest.log</string>")
})

test("the systemd unit quotes its command and escapes specifiers", () => {
  expect(
    KiloLoginService.systemdUnit({
      description: "Kilo background server (kilo2 latest)",
      command: ["/home/me/my kilo/kilo", "serve", "--service", "100%$HOME"],
      path: "/usr/local/bin:/usr/bin",
    }),
  ).toBe(
    [
      "[Unit]",
      "Description=Kilo background server (kilo2 latest)",
      "",
      "[Service]",
      'ExecStart="/home/me/my kilo/kilo" "serve" "--service" "100%%$$HOME"',
      "Restart=on-failure",
      "WorkingDirectory=%h",
      'Environment="PATH=/usr/local/bin:/usr/bin"',
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n"),
  )
})

test("the systemd unit escapes control characters so a value cannot add a directive", () => {
  const unit = KiloLoginService.systemdUnit({
    description: "Kilo background server (kilo2 latest)",
    command: ["/home/me/kilo", "serve", "--service"],
    path: "/usr/bin\nExecStartPre=/bin/sh -c 'touch /tmp/pwned'",
  })
  expect(unit).toContain('Environment="PATH=/usr/bin\\nExecStartPre=/bin/sh -c \'touch /tmp/pwned\'"')
  expect(unit.split("\n").some((line) => line.startsWith("ExecStartPre="))).toBeFalse()
  expect(unit.split("\n").filter((line) => line.startsWith("Environment="))).toHaveLength(1)
})

test("the Windows task quotes the executable and arguments with spaces", () => {
  expect(KiloLoginService.taskCommand(["C:\\Program Files\\Kilo\\kilo.exe", "serve", "--service"])).toBe(
    '"C:\\Program Files\\Kilo\\kilo.exe" serve --service',
  )
})

test("refuses a development runner unless --command names an executable", async () => {
  expect(() => KiloLoginService.resolveCommand({ self: () => ["/usr/local/bin/bun", "run", "src/index.ts"] })).toThrow(
    "development build",
  )
  expect(() => KiloLoginService.resolveCommand({ self: () => ["/opt/node", "/repo/packages/cli/src/index.tsx"] })).toThrow(
    "--command <path>",
  )
  expect(KiloLoginService.resolveCommand({ self: () => ["/opt/kilo/bin/kilo"] })).toEqual(command)

  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-login-bin-"))
  try {
    const executable = path.join(directory, "kilo")
    await writeFile(executable, "#!/bin/sh\n", { mode: 0o755 })
    expect(
      KiloLoginService.resolveCommand({ executable, self: () => ["/usr/local/bin/bun", "src/index.ts"] }),
    ).toEqual([executable, "serve", "--service"])
    expect(() =>
      KiloLoginService.resolveCommand({ executable: path.join(directory, "missing"), self: () => ["/opt/kilo"] }),
    ).toThrow("is not an executable file")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test.skipIf(process.platform === "win32")("a --command path without an executable bit is refused", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-login-mode-"))
  try {
    const plain = path.join(directory, "kilo")
    await writeFile(plain, "#!/bin/sh\n", { mode: 0o644 })
    expect(() =>
      KiloLoginService.resolveCommand({ executable: plain, self: () => ["/opt/kilo/bin/kilo"] }),
    ).toThrow("is not an executable file")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("stops the installed launchd agent without removing it", async () => {
  await withHome(async (target) => {
    const { calls, run: runner } = recorder()
    const file = path.join(target.home, "Library", "LaunchAgents", "ai.kilo.kilo2.latest.plist")
    expect(await provided(KiloLoginService.stop(target, runner))).toEqual({ stopped: false })
    expect(calls).toEqual([])

    await provided(KiloLoginService.install(target, { command, path: undefined }, runner))
    calls.length = 0
    expect(await provided(KiloLoginService.stop(target, runner))).toMatchObject({ stopped: true })
    expect(calls).toEqual([["launchctl", "bootout", "gui/501/ai.kilo.kilo2.latest"]])
    expect(await exists(file)).toBeTrue()
  }, "darwin")
})

test("installs, reports and uninstalls the launchd agent idempotently", async () => {
  await withHome(async (target) => {
    const { calls, run: runner } = recorder()
    const file = path.join(target.home, "Library", "LaunchAgents", "ai.kilo.kilo2.latest.plist")

    expect(await provided(KiloLoginService.status(target, runner))).toEqual({
      kind: "launchd",
      name: "ai.kilo.kilo2.latest",
      installed: false,
      stale: false,
    })
    expect(await provided(KiloLoginService.uninstall(target, runner))).toMatchObject({ removed: false })
    expect(calls).toEqual([])

    const installed = await provided(KiloLoginService.install(target, { command, path: "/usr/bin" }, runner))
    expect(KiloLoginService.describe(installed)).toBe("login: installed (launchd, ai.kilo.kilo2.latest)")
    expect(await readFile(file, "utf8")).toContain("<string>/opt/kilo/bin/kilo</string>")
    expect(await exists(target.log)).toBeTrue()
    expect(calls).toEqual([
      ["launchctl", "bootout", "gui/501/ai.kilo.kilo2.latest"],
      ["launchctl", "bootstrap", "gui/501", file],
    ])
    expect((await provided(KiloLoginService.status(target, runner))).installed).toBeTrue()

    calls.length = 0
    expect(await provided(KiloLoginService.uninstall(target, runner))).toMatchObject({ removed: true })
    expect(calls).toEqual([["launchctl", "bootout", "gui/501/ai.kilo.kilo2.latest"]])
    expect(await exists(file)).toBeFalse()
    expect(KiloLoginService.describe(await provided(KiloLoginService.status(target, runner)))).toBe(
      "login: not installed",
    )
  }, "darwin")
})

test("reports a stale unit once the executable it records is gone", async () => {
  await withHome(async (target) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-login-stale-"))
    try {
      const executable = path.join(directory, "kilo")
      await writeFile(executable, "#!/bin/sh\n", { mode: 0o755 })
      const { run: runner } = recorder()
      await provided(
        KiloLoginService.install(target, { command: [executable, "serve", "--service"], path: undefined }, runner),
      )
      expect((await provided(KiloLoginService.status(target, runner))).stale).toBeFalse()

      await rm(executable)
      const state = await provided(KiloLoginService.status(target, runner))
      expect(state).toMatchObject({ installed: true, stale: true })
      expect(KiloLoginService.describe(state)).toContain("stale")
      expect(KiloLoginService.describe(state)).toContain("service install")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, "darwin")
})

test("a reinstall ignores an agent that is not loaded but fails when bootstrap fails", async () => {
  await withHome(async (target) => {
    const unloaded = recorder({ "launchctl bootout": 3 })
    await provided(KiloLoginService.install(target, { command, path: undefined }, unloaded.run))
    expect(unloaded.calls.map((call) => call[1])).toEqual(["bootout", "bootstrap"])

    const refused = recorder({ "launchctl bootstrap": 5 })
    await expect(
      provided(KiloLoginService.install(target, { command, path: undefined }, refused.run)),
    ).rejects.toThrow("`launchctl bootstrap gui/501")
    await expect(
      provided(KiloLoginService.install(target, { command, path: undefined }, refused.run)),
    ).rejects.toThrow("failed with exit code 5: denied by policy")
  }, "darwin")
})

test("installs and uninstalls the systemd user unit", async () => {
  await withHome(async (target) => {
    const { calls, run: runner } = recorder()
    const file = path.join(target.config, "systemd", "user", "kilo2-latest.service")
    await provided(KiloLoginService.install(target, { command, path: "/usr/bin" }, runner))
    expect(await readFile(file, "utf8")).toContain('ExecStart="/opt/kilo/bin/kilo" "serve" "--service"')
    // An explicit mode, so a permissive umask cannot leave a world-writable unit that systemd refuses to load. Windows
    // has no POSIX permission bits to check, and the systemd target is simulated there.
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o644)
    expect(calls).toEqual([
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "enable", "--now", "kilo2-latest.service"],
    ])

    calls.length = 0
    expect(await provided(KiloLoginService.uninstall(target, runner))).toMatchObject({ removed: true })
    expect(calls).toEqual([
      ["systemctl", "--user", "disable", "--now", "kilo2-latest.service"],
      ["systemctl", "--user", "daemon-reload"],
    ])
    expect(await exists(file)).toBeFalse()

    await provided(KiloLoginService.install(target, { command, path: undefined }, runner))
    calls.length = 0
    expect(await provided(KiloLoginService.stop(target, runner))).toMatchObject({ stopped: true })
    expect(calls).toEqual([["systemctl", "--user", "stop", "kilo2-latest.service"]])
    expect(await exists(file)).toBeTrue()
  }, "linux")
})

test("installs, starts, finds and deletes the Windows logon task", async () => {
  await withHome(async (target) => {
    const missing = recorder({ "schtasks /Query": 1 })
    expect((await provided(KiloLoginService.status(target, missing.run))).installed).toBeFalse()
    expect(await provided(KiloLoginService.uninstall(target, missing.run))).toMatchObject({ removed: false })
    expect(missing.calls).toEqual([
      ["schtasks", "/Query", "/TN", "Kilo kilo2 latest"],
      ["schtasks", "/Query", "/TN", "Kilo kilo2 latest"],
    ])

    const recorded = recorder()
    await provided(
      KiloLoginService.install(
        target,
        { command: ["C:\\Kilo\\kilo.exe", "serve", "--service"], path: undefined },
        recorded.run,
      ),
    )
    expect(await provided(KiloLoginService.stop(target, recorded.run))).toEqual({ stopped: false })
    await provided(KiloLoginService.uninstall(target, recorded.run))
    expect(recorded.calls).toEqual([
      [
        "schtasks",
        "/Create",
        "/F",
        "/SC",
        "ONLOGON",
        "/RL",
        "LIMITED",
        "/TN",
        "Kilo kilo2 latest",
        "/TR",
        '"C:\\Kilo\\kilo.exe" serve --service',
      ],
      ["schtasks", "/Run", "/TN", "Kilo kilo2 latest"],
      ["schtasks", "/Query", "/TN", "Kilo kilo2 latest"],
      ["schtasks", "/Delete", "/F", "/TN", "Kilo kilo2 latest"],
    ])
  }, "win32")
})

test("reports a stale Windows logon task when its recorded executable is gone", async () => {
  await withHome(async (target) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-login-win-stale-"))
    try {
      const executable = path.join(dir, "kilo&2.exe")
      await writeFile(executable, "binary")
      const escaped = executable.replaceAll("&", "&amp;")
      const xml = [
        `<?xml version="1.0" encoding="UTF-16"?>`,
        `<Task version="1.2">`,
        `  <Actions Context="Author">`,
        `    <Exec>`,
        `      <Command>&quot;${escaped}&quot;</Command>`,
        `      <Arguments>serve --service</Arguments>`,
        `    </Exec>`,
        `  </Actions>`,
        `</Task>`,
      ].join("\r\n")
      const recorded = recorder({}, { "schtasks /Query /TN Kilo kilo2 latest /XML": xml })

      const active = await provided(KiloLoginService.status(target, recorded.run))
      expect(active).toEqual({
        kind: "schtasks",
        name: "Kilo kilo2 latest",
        installed: true,
        stale: false,
      })
      expect(recorded.calls).toEqual([
        ["schtasks", "/Query", "/TN", "Kilo kilo2 latest"],
        ["schtasks", "/Query", "/TN", "Kilo kilo2 latest", "/XML"],
      ])

      await rm(executable)
      const stale = await provided(KiloLoginService.status(target, recorded.run))
      expect(stale).toMatchObject({ installed: true, stale: true })
      expect(KiloLoginService.describe(stale)).toBe(
        "login: stale (schtasks, Kilo kilo2 latest), run `kilo2 service install` again",
      )

      const unquoted = recorder(
        {},
        {
          "schtasks /Query /TN Kilo kilo2 latest /XML": `<Task><Actions><Exec><Command>${escaped}</Command></Exec></Actions></Task>`,
        },
      )
      expect((await provided(KiloLoginService.status(target, unquoted.run))).stale).toBeTrue()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, "win32")
})

test("an unsupported platform fails with a clear message", async () => {
  await withHome(async (target) => {
    await expect(provided(KiloLoginService.status(target, recorder().run))).rejects.toThrow(
      "not supported on freebsd",
    )
  }, "freebsd")
})
