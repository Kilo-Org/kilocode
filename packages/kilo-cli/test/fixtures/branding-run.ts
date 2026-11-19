// Shared by the branding test files. Each file runs in its own test process, so the slow source and compiled
// fixtures of the branding suite run in parallel.
import { expect } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { brandingPlugin } from "../../src/branding/plugin"
import { KiloLogo } from "../../src/branding/logo-art"
import { logo } from "../../../tui/src/logo"

export const repo = path.resolve(import.meta.dir, "../../../..")

// The intercepted server modules: the upstream text each one answers with, and its Kilo form.
export const serverText = [
  ["server/src/handlers/server.ts", "Run `opencode pair` to get a new one.", "Run `kilo2 pair` to get a new one."],
  ["server/src/process.ts", "Run `opencode service restart` after", "Run `kilo2 service restart` after"],
] as const

// The intercepted core modules: each upstream text that names the host to a person or to the model, and its Kilo form.
// A module is listed once per text, and the lists are the whole difference the loader makes in these modules.
export const coreText = [
  ["core/src/artifact.ts", "served as HTML by this OpenCode server", "served as HTML by this Kilo server"],
  ["core/src/generate.ts", "API opencode can call (package", "API Kilo can call (package"],
  [
    "core/src/tool/plugin/websearch.ts",
    "Allow OpenCode to search the web for up-to-date information?",
    "Allow Kilo to search the web for up-to-date information?",
  ],
  [
    "core/src/plugin/provider/claude-agent/language-model/system-prompt.ts",
    "You are running in OpenCode through the Claude Code harness.",
    "You are running in Kilo through the Claude Code harness.",
  ],
  [
    "core/src/plugin/provider/claude-agent/language-model/system-prompt.ts",
    "# Agent role (from OpenCode)",
    "# Agent role (from Kilo)",
  ],
  [
    "core/src/plugin/provider/claude-agent/sync/catch-up.ts",
    "conversation history from OpenCode that you have not seen",
    "conversation history from Kilo that you have not seen",
  ],
  [
    "core/src/plugin/provider/claude-agent/claude/sessions.ts",
    "The OpenCode tool server did not connect to Claude Code",
    "The Kilo tool server did not connect to Claude Code",
  ],
  [
    "core/src/plugin/provider/claude-agent/tools/pending.ts",
    "Claude invoked an OpenCode tool without its PreToolUse ID",
    "Claude invoked a Kilo tool without its PreToolUse ID",
  ],
  [
    "core/src/plugin/provider/claude-agent/tools/server.ts",
    "Claude Code called an unregistered OpenCode tool:",
    "Claude Code called an unregistered Kilo tool:",
  ],
] as const

// The intercepted module of the plugin package: the loader the host installs for user plugins.
export const pluginText = [
  [
    "plugin/src/runtime.ts",
    "is not provided by OpenCode; plugins must use the host's",
    "is not provided by Kilo; plugins must use the host's",
  ],
] as const

/** The server, core and plugin modules above, one entry per module with its texts in source order. */
export const branded = Object.entries(
  Object.groupBy([...serverText, ...coreText, ...pluginText], ([file]) => file),
).map(([file, texts = []]) => ({ file, texts }))

/**
 * The modules of `text` bundled as the compiled build bundles them (script/build.ts), with the branding plugin or
 * without it, so the loader's path filter is checked against a bundle as well as a source run.
 */
export async function bundle(text: ReadonlyArray<readonly [file: string, ...string[]]>, hosted: boolean) {
  const result = await Bun.build({
    entrypoints: [...new Set(text.map(([file]) => path.join(repo, "packages", file)))],
    plugins: hosted ? [brandingPlugin] : [],
    packages: "external",
    target: "bun",
  })
  expect(result.success, result.logs.map(String).join("\n")).toBe(true)
  return (await Promise.all(result.outputs.map((item) => item.text()))).join("\n")
}

/**
 * Runs `use` against the Kilo host's server, started from source as `bun dev` starts it. Requests authenticate with
 * the basic-auth user `opencode` and the password `secret`.
 */
export async function host(env: Record<string, string>, use: (url: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-branding-server-")))
  using backend = fixture()
  await mkdir(path.join(root, "tmp"))
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../../src/index.ts"), "serve", "--stdio"], {
    // The package directory, so its bunfig.toml preload installs the branding loader.
    cwd: path.resolve(import.meta.dir, "../.."),
    env: {
      // The test preload isolates XDG for in-process tests; a host boot must not inherit it, a directory override or
      // a developer's Kilo login.
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !key.startsWith("XDG_") && !/^(OPENCODE|KILO(2|CODE)?)_/.test(key),
        ),
      ),
      BUN_OPTIONS: "",
      HOME: root,
      USERPROFILE: root,
      TMPDIR: path.join(root, "tmp"),
      TEMP: path.join(root, "tmp"),
      TMP: path.join(root, "tmp"),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      // The server would fetch the models.dev catalog from its real host; the bundled snapshot is enough here.
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_SERVER_PASSWORD: "secret",
      KILO_API_URL: backend.url,
      ...env,
    },
    stdin: "pipe",
    stdout: "pipe",
    // A child that dies before it prints its URL shows why.
    stderr: "inherit",
    // Below the 60 s test timeout: a child that hangs, or ignores the end of stdin, is killed, so the cleanup runs.
    timeout: 50_000,
    killSignal: "SIGKILL",
  })
  try {
    const reader = child.stdout.getReader()
    const line = async (buffer = ""): Promise<string> => {
      if (buffer.includes("\n")) return buffer.slice(0, buffer.indexOf("\n"))
      const chunk = await reader.read()
      if (chunk.done) return buffer
      return line(buffer + new TextDecoder().decode(chunk.value))
    }
    const url = (JSON.parse(await line()) as { url: string }).url
    reader.releaseLock()
    await use(url)
  } finally {
    // The server treats EOF on stdin as the end of its lease.
    child.stdin.end()
    await child.exited
    await rm(root, { recursive: true, force: true })
  }
}

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
