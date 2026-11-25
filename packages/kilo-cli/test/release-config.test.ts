import { expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const script = path.join(import.meta.dir, "fixtures", "config-discovery.ts")

const files = {
  "kilo.json": JSON.stringify({ username: "root-kilo" }),
  // An existing repository config with v1 keys, which the v2 reader accepts.
  ".kilo/kilo.jsonc": JSON.stringify({
    $schema: "https://app.kilo.ai/config.json",
    permission: { edit: "ask", bash: { "git push": "ask" } },
    mcp: { docs: { type: "remote", url: "https://example.invalid/mcp", enabled: false } },
    command: { inline: { template: "Inline $ARGUMENTS" } },
  }),
  ".kilo/command/release.md": "Release command",
  ".kilo/skills/release/SKILL.md": "---\nname: release\ndescription: Release skill\n---\nRelease",
}

// The fixture runs in a child process because `KiloConfigFiles` reads the variable when it loads. HOME and the XDG
// bases point into the temporary root so the child touches no real Kilo data.
async function discover() {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-release-config-")))
  await using tmp = { dir, [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }) }
  const project = path.join(tmp.dir, "repo")
  await mkdir(path.join(project, ".git"), { recursive: true })
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(project, file)), { recursive: true })
    await writeFile(path.join(project, file), content)
  }
  const child = Bun.spawn(
    [process.execPath, script, project, path.join(tmp.dir, "global"), "release"],
    {
      cwd: path.join(import.meta.dir, ".."),
      env: {
        ...process.env,
        OPENCODE_TEST_HOME: tmp.dir,
        XDG_DATA_HOME: path.join(tmp.dir, "data"),
        XDG_CONFIG_HOME: path.join(tmp.dir, "config"),
        XDG_STATE_HOME: path.join(tmp.dir, "state"),
        XDG_CACHE_HOME: path.join(tmp.dir, "cache"),
      },
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
  return JSON.parse(stdout) as { config: string[]; commands: string[]; skills: string[] }
}

test("stable config, commands and skills load without a runtime switch", async () => {
  const result = await discover()
  expect(result.config).toEqual(["kilo.json", ".kilo/kilo.jsonc", ".kilo"])
  expect(result.commands).toContain("release")
  expect(result.commands).toContain("inline")
  expect(result.commands).not.toContain("internal")
  expect(result.skills).toContain("release")
  expect(result.skills).not.toContain("internal")
}, 30_000)
