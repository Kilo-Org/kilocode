import { fixture } from "@kilocode/gateway-core/testing"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const repo = path.resolve(import.meta.dir, "../../..")
const binary = process.argv[2] && path.resolve(process.argv[2])
if (process.argv.length > 3) throw new Error("Usage: bun script/branding-smoke.ts [compiled-binary-path]")
const root = await mkdtemp(path.join(os.tmpdir(), "kilo-branding-smoke-"))
const profile = path.join(root, "profile")
const dirs = Object.fromEntries(["home", "data", "config", "state", "cache", "tmp"].map((key) => [key, path.join(profile, key)]))
let output = ""
const decoder = new TextDecoder()

try {
  await Promise.all([...Object.values(dirs), path.join(root, "workspace")].map((dir) => mkdir(dir, { recursive: true })))
  using backend = fixture()
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|LANG|LC_ALL|TZ|SystemRoot|WINDIR|PATHEXT)$/.test(key))),
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
    KILO_REBRAND_PROBE: "1",
    KILO_API_URL: backend.url,
    KILO_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: "kilo/kilo-auto/free", enabled_providers: ["kilo"] }),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  }
  const found = Promise.withResolvers<void>()
  const terminal = new Bun.Terminal({
    cols: 120,
    rows: 40,
    data(terminal, data) {
      const text = decoder.decode(data, { stream: true })
      output = (output + text).slice(-200_000)
      if (text.includes("\x1b[6n")) terminal.write("\x1b[1;1R")
      if (Bun.stripANSI(output).includes("KILO REBRAND PROBE")) found.resolve()
    },
  })
  try {
    const child = Bun.spawn(binary ? [binary, "--standalone"] : [process.execPath, "dev", "--standalone"], {
      cwd: binary ? path.join(root, "workspace") : repo,
      env,
      terminal,
      detached: true,
    })
    const timeout = setTimeout(() => found.reject(new Error("Timed out after 45 seconds waiting for the home logo")), 45_000)
    try {
      await Promise.race([
        found.promise,
        child.exited.then((code) => { throw new Error(`CLI exited before the home logo appeared (code ${code})`) }),
      ])
      console.log(`PASS: ${binary ? "compiled" : "source"} TUI rendered KILO REBRAND PROBE`)
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
  throw new Error(`Branding smoke failed: ${error instanceof Error ? error.message : String(error)}\n${Bun.stripANSI(output)}`, { cause: error })
} finally {
  await rm(root, { recursive: true, force: true })
}
