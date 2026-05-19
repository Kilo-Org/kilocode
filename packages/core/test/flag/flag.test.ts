import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"

// kilocode_change start
const FLAG_MODULE = pathToFileURL(path.join(import.meta.dir, "../../src/flag/flag.ts")).href

async function loadSkillFlags(env: Record<string, string>) {
  const childEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) childEnv[key] = value
  }

  Object.assign(childEnv, env)
  for (const key of ["KILO_DISABLE_CLAUDE_CODE", "KILO_DISABLE_CLAUDE_CODE_SKILLS", "KILO_DISABLE_EXTERNAL_SKILLS"]) {
    if (!(key in env)) delete childEnv[key]
  }

  const proc = Bun.spawn({
    cmd: [
      process.execPath,
      "--eval",
      `import { Flag } from ${JSON.stringify(FLAG_MODULE)};
       console.log(JSON.stringify({
         claudeCode: Flag.KILO_DISABLE_CLAUDE_CODE,
         claudeSkills: Flag.KILO_DISABLE_CLAUDE_CODE_SKILLS,
         externalSkills: Flag.KILO_DISABLE_EXTERNAL_SKILLS,
       }));`,
    ],
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  expect(stderr).toBe("")
  expect(exitCode).toBe(0)
  return JSON.parse(stdout) as {
    claudeCode: boolean
    claudeSkills: boolean
    externalSkills: boolean
  }
}

describe("Flag skill toggles", () => {
  test("disabling Claude Code does not disable external skills", async () => {
    const flags = await loadSkillFlags({ KILO_DISABLE_CLAUDE_CODE: "true" })

    expect(flags.claudeCode).toBe(true)
    expect(flags.claudeSkills).toBe(true)
    expect(flags.externalSkills).toBe(false)
  })

  test("external skills can still be disabled explicitly", async () => {
    const flags = await loadSkillFlags({ KILO_DISABLE_EXTERNAL_SKILLS: "true" })

    expect(flags.externalSkills).toBe(true)
  })
})
// kilocode_change end
