import { fixture } from "@kilocode/gateway-core/testing"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const repo = path.resolve(import.meta.dir, "../../..")
const binary = process.argv[2] && path.resolve(process.argv[2])
if (process.argv.length > 3) throw new Error("Usage: bun script/theme-smoke.ts [compiled-binary-path]")
const root = await mkdtemp(path.join(os.tmpdir(), "kilo-theme-smoke-"))
using backend = fixture()

try {
  await mkdir(path.join(root, "workspace"))
  for (const mode of ["dark", "light"] as const) {
    const profile = path.join(root, mode)
    await mkdir(profile)
    const state = { output: "", change: () => {} }
    const decoder = new TextDecoder()
    const terminal = new Bun.Terminal({
      cols: 120,
      rows: 40,
      data(terminal, data) {
        const text = decoder.decode(data, { stream: true })
        state.output = (state.output + text).slice(-200_000)
        if (text.includes("\x1b[6n")) terminal.write("\x1b[1;1R")
        if (text.includes("\x1b]11;?"))
          terminal.write(mode === "dark" ? "\x1b]11;rgb:0c0c/0a0a/0909\x07" : "\x1b]11;rgb:ffff/ffff/ffff\x07")
        state.change()
      },
    })
    const child = Bun.spawn(binary ? [binary, "--standalone"] : [process.execPath, "dev", "--standalone"], {
      cwd: binary ? path.join(root, "workspace") : repo,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => /^(PATH|LANG|LC_ALL|TZ|SystemRoot|WINDIR|PATHEXT)$/.test(key)),
        ),
        KILO_V2_PROFILE: profile,
        HOME: profile,
        OPENCODE_TEST_HOME: path.join(profile, "home"),
        XDG_CONFIG_HOME: path.join(profile, "config"),
        XDG_DATA_HOME: path.join(profile, "data"),
        XDG_STATE_HOME: path.join(profile, "state"),
        XDG_CACHE_HOME: path.join(profile, "cache"),
        INIT_CWD: path.join(root, "workspace"),
        KILO_API_URL: backend.url,
        KILO_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: "kilo/kilo-auto/free", enabled_providers: ["kilo"] }),
        OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({ theme: { mode }, animations: false }),
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
      terminal,
    })
    const until = async (label: string, predicate: (output: string) => boolean) => {
      const found = Promise.withResolvers<void>()
      const check = () => {
        if (predicate(state.output)) found.resolve()
      }
      state.change = check
      check()
      const timeout = setTimeout(
        () => found.reject(new Error(`Timed out waiting for ${label}\n${Bun.stripANSI(state.output)}`)),
        45_000,
      )
      try {
        await Promise.race([
          found.promise,
          child.exited.then((code) => {
            throw new Error(`CLI exited before ${label} (code ${code})`)
          }),
        ])
      } finally {
        clearTimeout(timeout)
        state.change = () => {}
      }
    }
    const send = async (keys: string, label: string, predicate: (output: string) => boolean) => {
      state.output = ""
      const found = until(label, predicate)
      terminal.write(keys)
      await found
    }
    const primary = mode === "dark" ? ";255;221;0" : ";115;100;0"
    try {
      await until(`${mode} home screen`, (output) => Bun.stripANSI(output).includes("ctrl+p commands"))
      if (!state.output.includes(mode === "dark" ? "48;2;12;10;9" : "48;2;255;255;255"))
        throw new Error(`Missing Kilo ${mode} background`)
      console.log(`PASS: ${binary ? "compiled" : "source"} default Kilo ${mode} home screen`)
      await send("/themes", "theme command", (output) => Bun.stripANSI(output).includes("Switch theme"))
      await send("\r", "Kilo in theme picker", (output) => Bun.stripANSI(output).includes("kilo"))
      await send("opencode", "OpenCode preview", (output) =>
        output.includes(mode === "dark" ? ";250;178;131" : ";59;125;216"),
      )
      await send("\x1b", "Kilo restored on cancel", (output) => output.includes(primary))
      console.log(`PASS: ${binary ? "compiled" : "source"} ${mode} picker, upstream preview and cancel`)
    } finally {
      terminal.write("\x03")
      await Promise.race([child.exited, Bun.sleep(2000)])
      child.kill("SIGKILL")
      await child.exited
      terminal.close()
    }
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
