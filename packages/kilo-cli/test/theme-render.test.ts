import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { brandingPlugin } from "../src/branding/plugin"
import { hostMirrorsPlugin } from "../src/mirrors"

const repo = path.resolve(import.meta.dir, "../../..")
const entry = path.join(import.meta.dir, "fixtures/theme-render.ts")

for (const hosted of [false, true]) {
  for (const compiled of [false, true]) {
    const name = `${compiled ? "compiled" : "source"} ThemeProvider ${hosted ? "hosted" : "unhosted"}`
    test(
      name,
      async () => {
        await using root = await temporary()
        const outfile = path.join(root.path, process.platform === "win32" ? "theme.exe" : "theme")
        if (compiled) {
          const result = await Bun.build({
            entrypoints: [entry],
            plugins: [...(hosted ? [hostMirrorsPlugin, brandingPlugin] : []), createSolidTransformPlugin()],
            compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
            define: { KILO_BRANDING_COMPILED: "true" },
          })
          expect(result.success, result.logs.map(String).join("\n")).toBe(true)
        }
        const result = JSON.parse(
          await run(compiled ? [outfile] : [process.execPath, entry], root.path, hosted, compiled),
        ) as {
          hosted: boolean
          results: {
            scenario: string
            active: string
            modes: { mode: string; text: number[]; action: number[] }[]
            errors: string[]
            registry: string[]
          }[]
        }
        expect(result.hosted).toBe(hosted)
        expect(result.results.map((result) => result.scenario)).toEqual([
          "default",
          "opencode",
          "unknown",
          "invalid",
          "custom",
        ])
        for (const scenario of result.results) {
          expect(scenario.modes.map((mode) => mode.mode)).toEqual(["dark", "light", "dark"])
          expect(scenario.modes[0]).toEqual(scenario.modes[2])
          expect(scenario.modes[0].text).not.toEqual(scenario.modes[1].text)
          expect(scenario.registry.includes("kilo")).toBe(hosted || scenario.scenario === "custom")
        }
        expect(result.results[0].active).toBe(hosted ? "kilo" : "opencode")
        expect(result.results[1].active).toBe("opencode")
        expect(result.results[2].active).toBe("unknown")
        expect(result.results[3].active).toBe("opencode")
        expect(result.results[3].errors).toEqual(["invalid"])
        expect(result.results[4].active).toBe("kilo")
        expect(result.results[4].modes[0].text).toEqual([18, 52, 86, 255])
        expect(result.results[4].modes[1].text).toEqual([101, 67, 33, 255])
        if (hosted) {
          expect(result.results[0].modes[0].text).toEqual([250, 250, 249, 255])
          expect(result.results[0].modes[1].text).toEqual([12, 10, 9, 255])
          expect(result.results[0].modes[0].action).not.toEqual(result.results[1].modes[0].action)
        }
        for (const index of [2, 3]) expect(result.results[index].modes).toEqual(result.results[1].modes)
      },
      120_000,
    )
  }
}

async function temporary() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-theme-render-"))
  return { path: directory, [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }) }
}

async function run(command: string[], root: string, hosted: boolean, compiled: boolean) {
  const child = Bun.spawn(command, {
    cwd: repo,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => /^(PATH|LANG|LC_ALL|TZ|SystemRoot|WINDIR|PATHEXT)$/.test(key)),
      ),
      BUN_OPTIONS: "",
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
      KILO_BRANDING_TEST_HOSTED: (compiled ? !hosted : hosted) ? "1" : "0",
      KILO_THEME_TEST_HOSTED: hosted ? "1" : "0",
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(code, stderr).toBe(0)
  return stdout
}
