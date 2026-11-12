import { expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const script = path.join(import.meta.dir, "fixtures", "config-discovery.ts")

const files = {
  "kilo2.json": JSON.stringify({ username: "root-kilo2" }),
  ".kilo2/kilo2.jsonc": JSON.stringify({ shell: "dot-kilo2" }),
  ".kilo2/command/internal.md": "Internal command",
  ".kilo2/skills/internal/SKILL.md": "---\nname: internal\ndescription: Internal skill\n---\nInternal",
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
async function discover(release: boolean) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-release-config-")))
  const project = path.join(root, "repo")
  await mkdir(path.join(project, ".git"), { recursive: true })
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(project, file)), { recursive: true })
    await writeFile(path.join(project, file), content)
  }
  const env = {
    ...process.env,
    OPENCODE_TEST_HOME: root,
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_STATE_HOME: path.join(root, "state"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    KILO_USE_RELEASE_CONFIG: release ? "1" : undefined,
  }
  try {
    const result = Bun.spawnSync(
      [process.execPath, script, project, path.join(root, "global"), release ? "release" : "internal"],
      {
        cwd: path.join(import.meta.dir, ".."),
        env,
        stderr: "pipe",
      },
    )
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    return JSON.parse(result.stdout.toString()) as { config: string[]; commands: string[]; skills: string[] }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test("by default the server reads kilo2.json and .kilo2 and ignores .kilo", async () => {
  const result = await discover(false)
  expect(result.config).toEqual(["kilo2.json", ".kilo2/kilo2.jsonc", ".kilo2"])
  expect(result.commands).toContain("internal")
  expect(result.commands).not.toContain("release")
  expect(result.commands).not.toContain("inline")
  expect(result.skills).toContain("internal")
  expect(result.skills).not.toContain("release")
}, 30_000)

test("KILO_USE_RELEASE_CONFIG=1 reads kilo.json and .kilo and ignores .kilo2", async () => {
  const result = await discover(true)
  expect(result.config).toEqual(["kilo.json", ".kilo/kilo.jsonc", ".kilo"])
  expect(result.commands).toContain("release")
  expect(result.commands).toContain("inline")
  expect(result.commands).not.toContain("internal")
  expect(result.skills).toContain("release")
  expect(result.skills).not.toContain("internal")
}, 30_000)
