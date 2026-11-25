import { expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"

const planFile = pathToFileURL(path.join(import.meta.dir, "../src/plan/plan-file.ts")).href
const skillConfig = pathToFileURL(path.join(import.meta.dir, "../src/skill/config.ts")).href

// The config names are fixed when `KiloConfigFiles` loads, so each variant runs in a child process.
async function load() {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `import fs from "node:fs"
       import os from "node:os"
       import path from "node:path"
       import { Effect } from "effect"
       const { PlanFile } = await import(${JSON.stringify(planFile)})
       const { KiloSkillConfigPlugin } = await import(${JSON.stringify(skillConfig)})
       const project = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-release-plan-"))
       fs.mkdirSync(path.join(project, ".git"))
       const plans = path.relative(project, PlanFile.directory({ directory: project, project: { directory: project } }, "/data"))
       fs.rmSync(project, { recursive: true, force: true })
       const added = []
       const editor = { remove: () => {}, add: (item) => added.push(item) }
       await Effect.runPromise(KiloSkillConfigPlugin.Plugin.effect({ skill: { transform: (fn) => Effect.sync(() => fn(editor)) } }))
       process.stdout.write(JSON.stringify({ plans, skill: added[0].content.split(/\\r?\\n/)[0] }))`,
    ],
    {
      cwd: path.join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(code, stderr).toBe(0)
  return JSON.parse(stdout) as { plans: string; skill: string }
}

test("by default plans live in .kilo and the config skill starts with the guide", async () => {
  expect(await load()).toEqual({ plans: path.join(".kilo", "plans"), skill: "# Kilo" })
}, 30_000)
