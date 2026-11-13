// Shared by the branding test files. Each file runs in its own test process, so the slow source and compiled
// fixtures of the branding suite run in parallel.
import { expect } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloLogo } from "../../src/branding/logo-art"
import { logo } from "../../../tui/src/logo"

export const repo = path.resolve(import.meta.dir, "../../../..")

export async function temporary() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-branding-"))
  return { path: directory, [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }) }
}

export async function run(command: string[], root: string, hosted: boolean, exitCode = 0) {
  const child = Bun.spawn(command, {
    cwd: repo,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => /^(PATH|LANG|LC_ALL|TZ|SystemRoot|WINDIR|PATHEXT)$/.test(key)),
      ),
      BUN_OPTIONS: "",
      KILO_V2_PROFILE: path.join(root, "profile"),
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
      KILO_BRANDING_TEST_HOSTED: hosted ? "1" : "0",
    },
    stdout: "pipe",
    stderr: "pipe",
    // A cold source run transpiles the TUI and takes more than 15 s on loaded Windows runners. Stay below the 60 s
    // test timeout so a stuck child still fails with its stderr.
    timeout: 50_000,
    killSignal: "SIGKILL",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(code, stderr).toBe(exitCode)
  return stdout + (exitCode ? stderr : "")
}

export function checkEpilogue(output: string, hosted: boolean, columns: number, scenario = "session") {
  if (scenario === "none") {
    expect(output).toBe("")
    return
  }
  const lines = Bun.stripANSI(output.trimEnd()).split("\n")
  const artLines = lines.filter((line) => /[█▀▄]/.test(line))
  const art = KiloLogo.art({})
  const full = hosted ? art.logo : logo
  const expected =
    hosted && columns > 0 && columns < art.widths.full + 2
      ? art.compact
      : full.left.map((line, index) => `${line} ${full.right[index]}`)
  expect(artLines).toEqual(
    expected.map((line) => `  ${line.replaceAll("_", " ").replaceAll("^", "▀").replaceAll("~", "▀")}`),
  )
  if (scenario === "session" || scenario === "both") {
    expect(output).toContain("Session")
    expect(output).toContain(`${hosted ? "kilo2" : "opencode"} -s ses_example`)
  }
  if (scenario === "update" || scenario === "both") {
    expect(Bun.stripANSI(output)).toContain(`Run ${hosted ? "kilo2" : "opencode"} to use 2.1.4`)
  }
  if (columns > 0) for (const line of artLines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(columns)
}
