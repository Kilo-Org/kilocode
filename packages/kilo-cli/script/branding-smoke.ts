import { fixture } from "@kilocode/gateway-core/testing"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloLogo } from "../src/branding/logo-art"

// TODO(rebrand, #15324): Before merging a rebrand PR, refresh its verification evidence with the current
// head/base, generated progress totals and test results. Recheck CI, including the automated reviewer;
// pending/running check status belongs in the PR, not in a permanent runtime-bug claim.
const repo = path.resolve(import.meta.dir, "../../..")
const binary = process.argv[2] && path.resolve(process.argv[2])
const unicode = process.env.KILO_UNICODE_LOGO ?? "0"
const wordmark = KiloLogo.art({ KILO_UNICODE_LOGO: unicode }).logo.left[0].trimEnd()
if (process.argv.length > 3) throw new Error("Usage: bun script/branding-smoke.ts [compiled-binary-path]")
const root = await mkdtemp(path.join(os.tmpdir(), "kilo-branding-smoke-"))
const profile = path.join(root, "profile")
const dirs = Object.fromEntries(
  ["home", "data", "config", "state", "cache", "tmp"].map((key) => [key, path.join(profile, key)]),
)
let output = ""
let openedUpdate = false
let confirmedUpdate = false
const decoder = new TextDecoder()

try {
  await Promise.all(
    [...Object.values(dirs), path.join(root, "workspace")].map((dir) => mkdir(dir, { recursive: true })),
  )
  using backend = fixture()
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => /^(PATH|LANG|LC_ALL|TZ|SystemRoot|WINDIR|PATHEXT)$/.test(key)),
    ),
    HOME: dirs.home,
    USERPROFILE: dirs.home,
    OPENCODE_TEST_HOME: dirs.home,
    XDG_DATA_HOME: dirs.data,
    XDG_CONFIG_HOME: dirs.config,
    XDG_STATE_HOME: dirs.state,
    XDG_CACHE_HOME: dirs.cache,
    TMPDIR: dirs.tmp,
    TEMP: dirs.tmp,
    TMP: dirs.tmp,
    INIT_CWD: path.join(root, "workspace"),
    KILO_V2_PROFILE: profile,
    KILO_API_URL: backend.url,
    KILO_DISABLE_AUTOUPDATE: "1",
    KILO_UNICODE_LOGO: unicode,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: "kilo/kilo-auto/free", enabled_providers: ["kilo"] }),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  }
  const program = binary ? [binary] : [process.execPath, "dev"]
  for (const check of [
    { args: ["--help"], code: 0, text: "Kilo command line interface" },
    { args: ["auth", "logout", "--help"], code: 0, text: "kilo2 auth logout" },
    { args: ["upgrade", "99.0.0", "--method", "npm"], code: 1, text: "Kilo updates are disabled" },
    { args: ["update", "99.0.0", "--method", "curl"], code: 1, text: "Kilo updates are disabled" },
  ]) {
    const child = Bun.spawn([...program, ...check.args], {
      cwd: binary ? path.join(root, "workspace") : repo,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    const text = Bun.stripANSI(stdout + stderr)
    if (code !== check.code || !text.includes(check.text))
      throw new Error(`Kilo command check failed: ${check.args.join(" ")} (code ${code})\n${text}`)
  }
  const found = Promise.withResolvers<void>()
  const terminal = new Bun.Terminal({
    cols: 120,
    rows: 40,
    data(terminal, data) {
      const text = decoder.decode(data, { stream: true })
      output = (output + text).slice(-200_000)
      if (text.includes("\x1b[6n")) terminal.write("\x1b[1;1R")
      const screen = Bun.stripANSI(output)
      if (
        !openedUpdate &&
        /\x1b\](?:0|2);Kilo(?:\x07|\x1b\\)/.test(output) &&
        screen.includes("ctrl+p commands") &&
        screen.includes(wordmark) &&
        screen.includes(" v2") &&
        output.includes("38;2;255;221;0")
      ) {
        openedUpdate = true
        terminal.write("/update")
      }
      if (
        openedUpdate &&
        !confirmedUpdate &&
        screen.includes("/update") &&
        screen.includes("Kilo update instructions")
      ) {
        confirmedUpdate = true
        terminal.write("\r")
      }
      if (confirmedUpdate && screen.includes("Kilo updates are disabled")) found.resolve()
    },
  })
  try {
    const child = Bun.spawn(binary ? [binary, "--standalone"] : [process.execPath, "dev", "--standalone"], {
      cwd: binary ? path.join(root, "workspace") : repo,
      env,
      terminal,
      detached: true,
    })
    const timeout = setTimeout(
      () => found.reject(new Error("Timed out after 45 seconds waiting for the Kilo home screen")),
      45_000,
    )
    try {
      await Promise.race([
        found.promise,
        child.exited.then((code) => {
          throw new Error(`CLI exited before the Kilo home screen appeared (code ${code})`)
        }),
      ])
      console.log(
        `PASS: ${binary ? "compiled" : "source"} Kilo logo, help, blocked upgrades, terminal title and update instructions`,
      )
    } finally {
      clearTimeout(timeout)
      terminal.write("\x03")
      await Promise.race([child.exited, Bun.sleep(2_000)])
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
      }
      child.kill("SIGKILL")
      await Promise.race([child.exited, Bun.sleep(2_000)])
    }
  } finally {
    terminal.close()
  }
} catch (error) {
  throw new Error(
    `Branding smoke failed: ${error instanceof Error ? error.message : String(error)}\n${Bun.stripANSI(output)}`,
    { cause: error },
  )
} finally {
  await rm(root, { recursive: true, force: true })
}
