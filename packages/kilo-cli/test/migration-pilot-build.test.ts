import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, statfsSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"

// In build smoke runs, test the actual executable while trying to override its embedded choice.
const binary = process.env.KILO_V2_TEST_BINARY && path.resolve(process.env.KILO_V2_TEST_BINARY)
const modes = binary ? [process.env.KILO_V2_TEST_PILOT === "1"] : [false, true]
const wrapper = path.resolve(import.meta.dir, "../../../script/dev-isolated.ts")

for (const pilot of modes) {
  test(`${binary ? "packaged" : "source"} host ${pilot ? "gates boot and opens the accepted stable profile" : "keeps cutover disabled"}`, async () => {
    await using profile = await tmpdir("kilo-pilot-")
    const root = profile.path
    mkdirSync(path.join(root, ".git"))
    const source = path.join(root, "data/kilo/kilo.db")
    mkdirSync(path.dirname(source), { recursive: true })
    {
      using db = new Database(source)
      db.exec(readFileSync(path.join(import.meta.dir, "fixture/kilo-v1-schema.sql"), "utf8"))
      db.run("INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('global','/',1,1,'[]')")
      db.run(
        "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('ses_pilot','global','pilot',?,'Synthetic build smoke','7',1,1)",
        [root],
      )
    }
    const env = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      HOME: path.join(root, "home"),
      USERPROFILE: path.join(root, "home"),
      TMPDIR: path.join(root, "tmp"),
      TMP: path.join(root, "tmp"),
      TEMP: path.join(root, "tmp"),
      LANG: "en_US.UTF-8",
      KILO_V2_PROFILE: root,
      KILO_V2_TEST_BINARY: binary,
      KILO_INTERNAL_PROFILE_CUTOVER: (binary ? !pilot : pilot) ? "1" : "0",
      KILO_INTERNAL_PROFILE_CUTOVER_BUILD: pilot ? "0" : "1",
    }
    const run = (...args: string[]) =>
      Bun.spawnSync([process.execPath, wrapper, ...args], { cwd: root, env, stdin: "ignore" })
    if (!pilot) {
      const applied = run("migrate", "apply", "--accept-jetbrains-breakage")
      expect(applied.exitCode).toBe(1)
      expect(applied.stderr.toString()).toContain("disabled in this installation")
      expect(existsSync(path.join(root, "data/kilo2"))).toBe(false)
      const boot = run("debug", "paths")
      expect(boot.exitCode, boot.stderr.toString()).toBe(0)
      expectPaths(boot.stdout.toString(), root, "kilo2")
      expect(existsSync(`${source}.pre-v2`)).toBe(false)
      return
    }
    const blocked = run("debug", "paths")
    expect(blocked.exitCode).not.toBe(0)
    expect(blocked.stderr.toString()).toContain("--accept-jetbrains-breakage")
    expect(existsSync(path.join(root, "data/kilo2"))).toBe(false)
    const result = await accept(root, env)
    if (!supportedVolume(root)) {
      expect(result.code).not.toBe(0)
      expect(result.text).toContain("Safe database replacement requires local APFS, ext4, XFS or Btrfs")
      expect(existsSync(`${source}.pre-v2`)).toBe(false)
      return
    }
    expect(result.code, result.text).toBe(0)
    expectPaths(result.text, root, "kilo") // The command that displayed the confirmation, not just the next launch.
    const again = run("debug", "paths")
    expect(again.exitCode, again.stderr.toString()).toBe(0)
    expectPaths(again.stdout.toString(), root, "kilo")
    expect(existsSync(`${source}.pre-v2`)).toBe(true)
  }, 90_000)
}

function supportedVolume(root: string) {
  if (process.platform === "darwin") return Bun.spawnSync(["/bin/df", "-t", "apfs", root]).exitCode === 0
  return process.platform === "linux" && [0xef53, 0x58465342, 0x9123683e].includes(statfsSync(root).type >>> 0)
}

function expectPaths(output: string, root: string, app: string) {
  const paths = Object.fromEntries(output.split("\n").map((line) => line.trim().split(/\s+(.+)/)))
  for (const key of ["data", "state", "config", "cache", "tmp"]) expect(paths[key]).toBe(path.join(root, key, app))
  if (app === "kilo") expect(paths.db).toBe(path.join(root, "data/kilo/kilo.db"))
}

async function accept(cwd: string, env: NodeJS.ProcessEnv) {
  let text = ""
  let replied = false
  const decoder = new TextDecoder()
  const terminal = new Bun.Terminal({
    cols: 160,
    data(tty, bytes) {
      text += decoder.decode(bytes, { stream: true })
      if (!replied && text.includes("[y/N]")) {
        replied = true
        tty.write("y\r")
      }
    },
  })
  try {
    const child = Bun.spawn([process.execPath, wrapper, "debug", "paths"], { cwd, env, terminal, timeout: 60_000 })
    const code = await child.exited
    expect(replied, text).toBe(true)
    return { code, text: Bun.stripANSI(text).replaceAll("\r", "") }
  } finally {
    terminal.close()
  }
}
