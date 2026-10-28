import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
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
        const child = Bun.spawn(compiled ? [outfile] : [process.execPath, entry], {
          cwd: repo,
          env: {
            ...process.env,
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
        expect(JSON.parse(stdout)).toEqual({
          name: expected,
          spec: expected,
          nested: { name: expected, spec: expected },
        })
      } finally {
        await rm(tmp, { recursive: true, force: true })
      }
    }, 60_000)
  }
}
