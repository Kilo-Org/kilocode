import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { brandingProbe } from "../src/branding/probe-plugin"
import { logo, go } from "@opencode/tui/logo"

const probe = await import("../src/branding/probe-logo")
const entry = path.join(import.meta.dir, "fixtures/branding-probe.ts")

for (const enabled of [false, true]) {
  test(`source logo replacement is ${enabled ? "enabled" : "disabled"}`, async () => {
    await using root = await temporary()
    const result = await run([process.execPath, entry], root.path, enabled)
    const expected = enabled ? { logo: probe.logo, go: probe.go } : { logo, go }
    expect(result.relative).toEqual(expected)
    expect(result.exported).toEqual(expected)
  })

  test(`compiled logo replacement is ${enabled ? "enabled" : "disabled"}`, async () => {
    await using root = await temporary()
    const outfile = path.join(root.path, process.platform === "win32" ? "probe.exe" : "probe")
    const result = await Bun.build({
      entrypoints: [entry],
      plugins: enabled ? [brandingProbe] : [],
      compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
      define: { KILO_REBRAND_COMPILED: "true" },
    })
    expect(result.success, result.logs.map(String).join("\n")).toBe(true)
    const expected = enabled ? { logo: probe.logo, go: probe.go } : { logo, go }
    for (const runtimeEnabled of [false, true]) {
      const output = await run([outfile], root.path, runtimeEnabled)
      expect(output.relative).toEqual(expected)
      expect(output.exported).toEqual(expected)
    }
  }, 60_000)
}

async function temporary() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-rebrand-probe-"))
  return {
    path: directory,
    [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }),
  }
}

async function run(command: string[], root: string, enabled: boolean) {
  const child = Bun.spawn(command, {
    cwd: path.dirname(import.meta.dir),
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      OPENCODE_TEST_HOME: root,
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_STATE_HOME: path.join(root, "state"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      TMPDIR: root,
      TEMP: root,
      TMP: root,
      KILO_REBRAND_PROBE: enabled ? "1" : "0",
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(code, stderr).toBe(0)
  return JSON.parse(stdout)
}
