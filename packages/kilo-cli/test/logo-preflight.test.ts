import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { brandingPlugin } from "../src/branding/plugin"
import { KiloBranding } from "../src/branding/transform"

const repo = path.resolve(import.meta.dir, "../../..")
const entry = path.join(import.meta.dir, "fixtures/logo-preflight.ts")
const cases = [
  { width: 120, unicode: "1", outcome: "finish" },
  { width: 120, unicode: "0", outcome: "fail" },
  { width: 40, unicode: "1", outcome: "fail" },
  { width: 40, unicode: "0", outcome: "close" },
  { width: 20, unicode: "1", outcome: "close" },
  { width: 20, unicode: "0", outcome: "finish" },
] as const

test("preflight branding keeps all compact rows and brands the loading stage", async () => {
  const filename = path.join(repo, "packages/cli/src/services/update-preflight.tsx")
  const source = KiloBranding.transform(filename, await Bun.file(filename).text())
  expect(source).toContain('import { compact, palette } from "@opencode/tui/logo"')
  expect(source).toContain("const monogram = compact\n")
  expect(source).toContain("Loading Kilo")
  expect(source).toContain("flexShrink={0} width={Math.max(...monogram.map((line) => Bun.stringWidth(line)))}")
  expect(source).not.toContain("Loading OpenCode")
})

for (const compiled of [false, true]) {
  describe(`${compiled ? "compiled" : "source"} native preflight`, () => {
    let directory: string | undefined
    let command = [process.execPath, entry]

    beforeAll(async () => {
      if (!compiled || process.platform === "win32") return
      directory = await mkdtemp(path.join(os.tmpdir(), "kilo-preflight-build-"))
      const outfile = path.join(directory, "preflight")
      const result = await Bun.build({
        entrypoints: [entry],
        plugins: [brandingPlugin, createSolidTransformPlugin()],
        compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
        define: { KILO_BRANDING_COMPILED: "true" },
      })
      expect(result.success, result.logs.map(String).join("\n")).toBe(true)
      command = [outfile]
    }, 60_000)

    afterAll(async () => {
      if (directory) await rm(directory, { recursive: true, force: true })
    })

    for (const scenario of cases) {
      test.skipIf(process.platform === "win32")(
        `${scenario.width} columns, Unicode ${scenario.unicode}, ${scenario.outcome}`,
        async () => {
          const output = await run([...command, scenario.unicode, scenario.outcome], scenario.width)
          const text = Bun.stripANSI(output)
          expect(text).toContain(`fixture closed: ${scenario.outcome}`)
          expect(text).not.toContain("Restarting background server")
          expect(text).not.toContain("OpenCode")
          expect(text).toContain("Kilo")
          expect(text).toContain("█")
          if (scenario.unicode === "1") expect(text).toContain("🬺🬏")
          if (scenario.unicode === "0") expect(text).not.toMatch(/[\u{1FB00}-\u{1FBFF}]/u)
          if (scenario.width === 120) expect(text).toContain("fixture-old")
          expect(text).toMatch(scenario.unicode === "1" ? /██  ██.*?████🬺🬏.*?██  ██/s : /██  ██.*?████  .*?██  ██/s)
          expect(monogramColors(output)).toEqual(["2;255;221;0"])
          if (scenario.outcome === "finish") expect(text).toContain("Kilo updated")
          if (scenario.outcome === "fail") expect(text).toContain("Kilo update paused")
        },
        20_000,
      )
    }
  })
}

test("tracks monogram colors across SGR resets and background colors", () => {
  const ink = "\x1b[38;2;255;221;0m"
  expect(monogramColors(`${ink}██\x1b[48;2;0;0;0m🬺🬏\x1b[48;5;0m█`)).toEqual(["2;255;221;0"])
  expect(monogramColors(`${ink}█\x1b[0m█\x1b[m█\x1b[39m█`)).toEqual(["2;255;221;0", "default"])
  expect(monogramColors(`\x1b[0;48;2;0;0;0;38;2;255;221;0m█`)).toEqual(["2;255;221;0"])
  expect(monogramColors(`\x1b[38;5;3m█\x1b[33m█\x1b[93m█`)).toEqual(["5;3", "33", "93"])
  expect(monogramColors(`${ink}Loading Kilo`)).toEqual([])
})

function monogramColors(output: string) {
  const colors = new Set<string>()
  let foreground = "default"
  for (const token of output.matchAll(/\x1b\[([\d;]*)m|([█🬺🬏])/gu)) {
    if (token[2]) {
      colors.add(foreground)
      continue
    }
    const codes = token[1]!.split(";").map(Number)
    for (let index = 0; index < codes.length; index++) {
      const code = codes[index]!
      if (code === 38 || code === 48) {
        const length = codes[index + 1] === 2 ? 5 : 3
        if (code === 38) foreground = codes.slice(index + 1, index + length).join(";")
        index += length - 1
        continue
      }
      if (code === 0 || code === 39) foreground = "default"
      if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) foreground = String(code)
    }
  }
  return [...colors]
}

async function run(command: string[], width: number) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-preflight-"))
  const dirs = Object.fromEntries(
    ["home", "config", "data", "state", "cache", "tmp"].map((key) => [key, path.join(root, key)]),
  )
  const decoder = new TextDecoder()
  let output = ""
  let pending = ""
  let child: ReturnType<typeof Bun.spawn> | undefined
  let terminal: InstanceType<typeof Bun.Terminal> | undefined
  try {
    await Promise.all(Object.values(dirs).map((directory) => mkdir(directory, { recursive: true })))
    terminal = new Bun.Terminal({
      cols: width,
      rows: 24,
      data(terminal, data) {
        const text = decoder.decode(data, { stream: true })
        output += text
        pending += text
        while (pending.includes("\x1b[6n")) {
          pending = pending.slice(pending.indexOf("\x1b[6n") + 4)
          terminal.write("\x1b[1;1R")
        }
        pending = pending.slice(-3)
      },
    })
    child = Bun.spawn(command, {
      cwd: repo,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => /^(PATH|LANG|LC_ALL|TZ|SystemRoot|WINDIR|PATHEXT)$/.test(key)),
        ),
        BUN_OPTIONS: "",
        KILO_TEST: "1",
        KILO_V2_PROFILE: path.join(root, "profile"),
        HOME: dirs.home,
        USERPROFILE: dirs.home,
        OPENCODE_TEST_HOME: dirs.home,
        XDG_CONFIG_HOME: dirs.config,
        XDG_DATA_HOME: dirs.data,
        XDG_STATE_HOME: dirs.state,
        XDG_CACHE_HOME: dirs.cache,
        TMPDIR: dirs.tmp,
        TEMP: dirs.tmp,
        TMP: dirs.tmp,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
      terminal,
      timeout: 15_000,
    })
    expect(await child.exited, Bun.stripANSI(output)).toBe(0)
    return output
  } finally {
    if (child) {
      child.kill("SIGKILL")
      await child.exited
    }
    terminal?.close()
    await rm(root, { recursive: true, force: true })
  }
}
