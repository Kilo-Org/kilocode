import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { brandingPlugin } from "../src/branding/plugin"
import { hostMirrorsPlugin } from "../src/mirrors"

const repo = path.resolve(import.meta.dir, "../../..")
const entry = path.join(import.meta.dir, "fixtures/cli-name.ts")

for (const compiled of [false, true]) {
  for (const scenario of ["unhosted", "hosted", "configured"] as const) {
    test(`${compiled ? "compiled" : "source"} ${scenario} command name`, async () => {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "kilo-cli-name-"))
      const hosted = scenario !== "unhosted"
      const expected = scenario === "unhosted" ? "opencode" : scenario === "hosted" ? "kilo2" : "configured"
      try {
        const outfile = path.join(tmp, process.platform === "win32" ? "cli-name.exe" : "cli-name")
        if (compiled) {
          const result = await Bun.build({
            entrypoints: [entry],
            plugins: [...(hosted ? [hostMirrorsPlugin, brandingPlugin] : []), createSolidTransformPlugin()],
            compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
            define: {
              KILO_BRANDING_COMPILED: "true",
              ...(hosted ? { OPENCODE_CLI_NAME: JSON.stringify(expected) } : {}),
            },
          })
          expect(result.success).toBe(true)
          expect(result.logs).toEqual([])
        }
        for (const ambient of [false, true]) {
          const home = path.join(tmp, ambient ? "injected" : "clean")
          await mkdir(home)
          const child = Bun.spawn(compiled ? [outfile] : [process.execPath, entry], {
            cwd: repo,
            env: {
              ...Object.fromEntries(
                Object.entries(process.env).filter(([key]) =>
                  /^(PATH|LANG|LC_ALL|TZ|SystemRoot|WINDIR|PATHEXT)$/i.test(key),
                ),
              ),
              // An outer process may export these. The host and fixture must ignore them.
              ...(ambient
                ? {
                    KILO_NAME_TEST_HOSTED: hosted ? "0" : "1",
                    KILO_NAME_TEST_PREDEFINED: "ambient-name",
                    KILO_NAME_TEST_CHILD: "0",
                    KILO_BRANDING_TEST_HOSTED: "ambient",
                    OPENCODE_CONFIG: path.join(home, "missing.json"),
                  }
                : {}),
              BUN_OPTIONS: "",
              HOME: home,
              USERPROFILE: home,
              OPENCODE_TEST_HOME: home,
              XDG_CONFIG_HOME: path.join(home, "config"),
              XDG_DATA_HOME: path.join(home, "data"),
              XDG_STATE_HOME: path.join(home, "state"),
              XDG_CACHE_HOME: path.join(home, "cache"),
              TMPDIR: home,
              TEMP: home,
              TMP: home,
              KILO_NAME_TEST_HOSTED: hosted ? "1" : "0",
              KILO_NAME_TEST_PREDEFINED: scenario === "configured" ? (compiled ? "other" : expected) : "",
              KILO_NAME_TEST_CHILD: "1",
            },
            stdout: "pipe",
            stderr: "pipe",
            timeout: 30_000,
          })
          const [stdout, stderr, code] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
          ])
          expect(stderr).toBe("")
          expect(code).toBe(0)
          const env = {
            home,
            userProfile: home,
            testHome: home,
            config: path.join(home, "config"),
            data: path.join(home, "data"),
            state: path.join(home, "state"),
            cache: path.join(home, "cache"),
            bunOptions: "",
            branding: ambient ? "ambient" : undefined,
            opencodeConfig: ambient ? path.join(home, "missing.json") : undefined,
          }
          expect(JSON.parse(stdout)).toEqual({
            name: expected,
            spec: expected,
            env,
            nested: { name: expected, spec: expected, env },
          })
        }
      } finally {
        await rm(tmp, { recursive: true, force: true })
      }
    }, 60_000)
  }
}
