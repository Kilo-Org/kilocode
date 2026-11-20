import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"

test("internal cutover through the host: explicit consent, one switch, recoverable v1 history", async () => {
  await using profile = await tmpdir()
  mkdirSync(path.join(profile.path, ".git"))
  const data = path.join(profile.path, "data", "kilo")
  mkdirSync(data, { recursive: true })
  const worktree = path.join(profile.path, "other-checkout")
  const project = path.join(worktree, "packages", "app")
  mkdirSync(project, { recursive: true })
  mkdirSync(path.join(worktree, ".git"))
  // This installation has only the old per-channel filename. Boot and recovery must
  // agree with the importer rather than silently creating a new default database.
  const source = path.join(data, "opencode-local.db")
  {
    using db = new Database(source)
    db.exec(readFileSync(path.join(import.meta.dir, "fixture/kilo-v1-schema.sql"), "utf8"))
    db.run(
      "INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('global', '/', 1, 2, '[]')",
    )
    db.run(
      "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('ses_fixture', 'global', 'fixture', ?, 'Fixture', '7', 1, 2)",
      [project],
    )
  }
  const run = (...args: string[]) => runHost(profile.path, args)
  const before = statSync(source, { bigint: true }).mtimeNs
  expect((await run("migrate", "apply")).code).not.toBe(0)
  expect((await run("debug", "paths")).code).not.toBe(0)
  expect(statSync(source, { bigint: true }).mtimeNs).toBe(before)
  expect(existsSync(`${source}.pre-v2`)).toBe(false)
  // One conflict belongs to cwd; the skill belongs to a different project known only through its session.
  const rootConfig = path.join(profile.path, "kilo2.jsonc")
  const skills = path.join(worktree, ".kilo2", "skills")
  const skill = path.join(skills, "fixture", "SKILL.md")
  mkdirSync(path.dirname(skill), { recursive: true })
  writeFileSync(skill, "---\ndescription: Fixture skill\n---\nPreserve this text.")
  writeFileSync(rootConfig, '{"model":"kilo/fixture"}')
  const oldBytes = readFileSync(source)
  const blocked = await run("migrate", "apply", "--accept-jetbrains-breakage")
  expect(blocked.code).not.toBe(0)
  expect(blocked.stderr).toContain(rootConfig)
  expect(blocked.stderr).toContain(skills)
  expect(readFileSync(source)).toEqual(oldBytes)
  expect(statSync(source, { bigint: true }).mtimeNs).toBe(before)
  expect(existsSync(`${source}.pre-v2`)).toBe(false)
  expect(existsSync(path.join(profile.path, "data/kilo2"))).toBe(false)
  expect(readFileSync(skill, "utf8")).toContain("Preserve this text.")
  renameSync(rootConfig, path.join(profile.path, "kilo.jsonc"))
  renameSync(path.join(worktree, ".kilo2"), path.join(worktree, ".kilo"))
  const malformed = '{"text":"private-fixture-text"'
  {
    using db = new Database(source)
    db.run("INSERT INTO message VALUES ('msg_fixture', 'ses_fixture', 1, 1, ?)", [
      JSON.stringify({
        role: "user",
        time: { created: 1 },
        agent: "code",
        model: { providerID: "kilo", modelID: "fixture" },
      }),
    ])
    db.run("INSERT INTO part VALUES ('prt_bad', 'msg_fixture', 'ses_fixture', 1, 1, ?)", [malformed])
  }
  const original = readFileSync(source)
  const failed = await run("migrate", "apply", "--accept-jetbrains-breakage")
  // Unsupported filesystems must decline before changing a profile; exercise successful publication on supported hosts.
  if (process.platform === "win32" && failed.code !== 0) {
    expect(failed.stderr).toMatch(/windows|filesystem|requires local/i)
    expect(existsSync(`${source}.pre-v2`)).toBe(false)
    return
  }
  expect(failed.code).not.toBe(0)
  expect(failed.stderr).toContain('Incomplete transcript for session "ses_fixture"')
  expect(failed.stderr).toContain('"reason":"invalid-part"')
  expect(failed.stderr).toContain('"partID":"prt_bad"')
  expect(failed.stderr + failed.stdout).not.toContain("private-fixture-text")
  const status = JSON.parse((await run("migrate", "preflight")).stdout)
  expect(status).toMatchObject({ status: "failed", message: expect.stringContaining("ses_fixture") })
  expect(existsSync(`${source}.pre-v2`)).toBe(false)
  expect(readFileSync(source)).toEqual(original)
  {
    using db = new Database(source)
    expect(db.query("SELECT data FROM part WHERE id='prt_bad'").get()).toEqual({ data: malformed })
    expect(db.query("SELECT name FROM sqlite_master WHERE name='session_v2'").get()).toBeNull()
    db.run("UPDATE part SET data=? WHERE id='prt_bad'", [
      JSON.stringify({ type: "text", text: "Repaired synthetic message" }),
    ])
  }
  const deny = JSON.stringify([{ permission: "bash", pattern: "*", action: "deny" }])
  {
    using db = new Database(source)
    db.run("UPDATE session SET permission=?", [deny])
  }
  const restricted = await run("migrate", "recover", "--accept-jetbrains-breakage")
  expect(restricted.code).not.toBe(0)
  expect(restricted.stderr).toContain('session-specific permissions for "ses_fixture"')
  expect(existsSync(`${source}.pre-v2`)).toBe(false)
  {
    using db = new Database(source)
    expect(db.query("SELECT permission FROM session").get()).toEqual({ permission: deny })
    db.run("UPDATE session SET permission='[]'")
  }
  const input = path.join(profile.path, "config/kilo2/AGENTS.md")
  const target = path.join(profile.path, "config/kilo/AGENTS.md")
  mkdirSync(path.dirname(input), { recursive: true })
  writeFileSync(input, "Synthetic instructions")
  chmodSync(source, 0o644)
  {
    using reader = new Database(source, { readonly: true })
    reader.exec("BEGIN; SELECT id FROM session")
    const busy = await run("migrate", "recover", "--accept-jetbrains-breakage")
    expect(busy.stderr).toContain("Another SQLite client")
    expect(existsSync(target)).toBe(false)
    expect(existsSync(`${source}.pre-v2`)).toBe(false)
  }
  const applied = await run("migrate", "recover", "--accept-jetbrains-breakage")
  expect(applied.code, applied.stderr).toBe(0)
  expect(
    applied.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).status),
  ).toContain("completed")
  using active = new Database(source, { readonly: true })
  expect(active.query("SELECT id FROM session_v2").all()).toEqual([{ id: "ses_fixture" }])
  using backup = new Database(`${source}.pre-v2`, { readonly: true })
  expect(backup.query("SELECT id FROM session").all()).toEqual([{ id: "ses_fixture" }])
  expect(backup.query("SELECT name FROM sqlite_master WHERE name = 'session_v2'").all()).toEqual([])
  expect(statSync(`${source}.pre-v2`).mode & 0o777).toBe(0o600)
  expect(readFileSync(target, "utf8")).toBe("Synthetic instructions")
  const checked = await run("migrate", "preflight")
  expect(JSON.parse(checked.stdout).status).toBe("completed")
  const alternate = path.join(profile.path, "client-b")
  mkdirSync(alternate)
  writeFileSync(path.join(alternate, "kilo2.json"), '{"permission":{"bash":"deny"}}')
  writeFileSync(path.join(profile.path, "second.ts"), `process.env.KILO2_CONFIG_DIR=${JSON.stringify(alternate)}`)
  for (const args of [
    ["migrate", "preflight"],
    ["migrate", "observe"],
    ["migrate", "apply", "--accept-jetbrains-breakage"],
    ["debug", "paths"],
  ]) {
    const other = await runHost(profile.path, args, { BUN_OPTIONS: "--preload ./second.ts" })
    expect(other.code).not.toBe(0)
    expect(other.stderr).toContain(alternate)
    expect(other.stdout).not.toContain('"status":"completed"')
  }
  // Simulate exit after the durable rename but before the owner published its terminal status.
  const otherDB = path.join(alternate, "other.db")
  {
    using db = new Database(otherDB)
    db.exec("CREATE TABLE session_v2(id TEXT PRIMARY KEY); INSERT INTO session_v2 VALUES ('ses_other_client')")
  }
  writeFileSync(path.join(profile.path, "second.ts"), `process.env.KILO2_DB = ${JSON.stringify(otherDB)}`)
  const otherDbBoot = await runHost(profile.path, ["debug", "paths"], { BUN_OPTIONS: "--preload ./second.ts" })
  expect(otherDbBoot.code).not.toBe(0)
  expect(otherDbBoot.stderr).toContain(otherDB)
  const state = path.join(profile.path, "data/kilo2/migration", path.basename(source), "state.json")
  writeFileSync(state, JSON.stringify({ status: "running", phase: "Publishing database and recovery file" }))
  unlinkSync(target)
  writeFileSync(input, "Changed after publication")
  expect((await run("migrate", "recover", "--accept-jetbrains-breakage")).stderr).toContain("resources differ")
  expect(existsSync(target)).toBe(false)
  writeFileSync(input, "Synthetic instructions")
  expect(JSON.parse((await run("migrate", "preflight")).stdout).status).toBe("interrupted")
  const recovered = await run("migrate", "recover", "--accept-jetbrains-breakage")
  expect(recovered.code, recovered.stderr).toBe(0)
  expect(readFileSync(target, "utf8")).toBe("Synthetic instructions")
  expect(JSON.parse(recovered.stdout)).toMatchObject({ status: "completed", phase: "Recovery verified" })
  const boot = await run("debug", "paths")
  expect(boot.code, boot.stderr).toBe(0)
  expect(boot.stdout).toContain(source)
}, 90_000)

test.each([
  { variable: "KILO_CONFIG_DIR", name: "kilo.json", preview: false },
  { variable: "OPENCODE_CONFIG_DIR", name: "kilo2.json", preview: true },
])(
  "cutover preserves both files when $variable contains a conflicting configuration",
  async ({ variable, name, preview }) => {
    await using profile = await tmpdir()
    const root = profile.path
    const source = path.join(root, "data/kilo/kilo.db")
    const override = path.join(root, "override", name)
    const base = path.join(root, "config/kilo/kilo.json")
    for (const dir of [path.join(root, ".git"), path.dirname(source), path.dirname(override), path.dirname(base)])
      mkdirSync(dir, { recursive: true })
    {
      using db = new Database(source)
      db.exec(readFileSync(path.join(import.meta.dir, "fixture/kilo-v1-schema.sql"), "utf8"))
      db.run("INSERT INTO project (id,worktree,time_created,time_updated,sandboxes) VALUES ('global','/',1,1,'[]')")
      db.run(
        "INSERT INTO session (id,project_id,slug,directory,title,version,time_created,time_updated) VALUES ('ses_roots','global','roots',?,'Config roots fixture','7',1,1)",
        [root],
      )
    }
    const model = '{"model":"kilo/test"}'
    const deny = '{"permission":{"bash":"deny"}}'
    const overrideContents = preview ? deny : model
    const baseContents = preview ? model : deny
    writeFileSync(override, overrideContents)
    writeFileSync(base, baseContents)
    // The isolated launcher deliberately strips inherited real config paths. Supply a
    // fixture-only override after isolation, exactly where the CLI would receive it.
    const preload = path.join(root, "fixture-override.ts")
    writeFileSync(preload, `process.env.${variable} = ${JSON.stringify(path.dirname(override))}`)
    const before = readFileSync(source)
    const env = { BUN_OPTIONS: "--preload ./fixture-override.ts" }
    const probe = await runHost(root, ["migrate", "preflight"], env)
    expect(JSON.parse(probe.stdout)).toMatchObject({
      [preview ? "previewConfig" : "legacyConfig"]: path.dirname(override),
      legacyDefaultConfig: path.dirname(base),
    })
    const result = await runHost(root, ["migrate", "apply", "--accept-jetbrains-breakage"], env)
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain(override)
    expect(result.stderr).toContain(base)
    expect(readFileSync(source)).toEqual(before)
    expect(existsSync(`${source}.pre-v2`)).toBe(false)
    expect(readFileSync(override, "utf8")).toBe(overrideContents)
    expect(readFileSync(base, "utf8")).toBe(baseContents)
  },
)

test("a session in a linked worktree blocks cutover when its primary checkout still holds legacy Agent Manager state", async () => {
  await using fixture = await tmpdir()
  const root = fixture.path
  const repo = path.join(root, "primary")
  const tree = path.join(repo, ".kilo/worktrees/feature")
  const source = path.join(root, "data/kilo/kilo.db")
  const legacy = path.join(repo, ".kilo/agent-manager.json")
  const preview = path.join(repo, ".kilo2/agent-manager.json")
  for (const dir of [repo, path.dirname(source), path.dirname(preview)]) mkdirSync(dir, { recursive: true })
  function git(...args: string[]) {
    const result = Bun.spawnSync(
      ["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args],
      {
        cwd: repo,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          HOME: root,
          USERPROFILE: root,
          GIT_CONFIG_NOSYSTEM: "1",
        },
      },
    )
    expect(result.exitCode, result.stderr.toString()).toBe(0)
  }
  git("init", "-q", "-b", "main")
  git("commit", "-q", "--allow-empty", "-m", "fixture")
  git("worktree", "add", "-q", "-b", "feature", tree)
  const createdAt = "2026-11-01T00:00:00Z"
  const manager = JSON.stringify({
    worktrees: { "wt-fixture": { branch: "feature", path: tree, parentBranch: "main", createdAt } },
    sessions: { ses_manager: { worktreeId: "wt-fixture", createdAt } },
  })
  const existing = JSON.stringify({ worktrees: {}, sessions: { ses_preview: { worktreeId: null, createdAt } } })
  writeFileSync(legacy, manager)
  writeFileSync(preview, existing)
  {
    using db = new Database(source)
    db.exec(readFileSync(path.join(import.meta.dir, "fixture/kilo-v1-schema.sql"), "utf8"))
    db.run("INSERT INTO project (id,worktree,time_created,time_updated,sandboxes) VALUES ('global','/',1,1,'[]')")
    db.run(
      "INSERT INTO session (id,project_id,slug,directory,title,version,time_created,time_updated) VALUES ('ses_manager','global','manager',?,'Agent Manager fixture','7',1,1)",
      [tree],
    )
  }
  const original = readFileSync(source)
  const result = await runHost(root, ["migrate", "apply", "--accept-jetbrains-breakage"])
  expect(result.code).not.toBe(0)
  expect(result.stderr).toContain(`Agent Manager worktree associations require reconciliation: ${legacy}`)
  expect(readFileSync(source)).toEqual(original)
  expect(existsSync(`${source}.pre-v2`)).toBe(false)
  expect(readFileSync(legacy, "utf8")).toBe(manager)
  expect(readFileSync(preview, "utf8")).toBe(existing)
  expect(existsSync(path.join(tree, ".git"))).toBe(true)
}, 30_000)

async function runHost(root: string, args: string[], extra: NodeJS.ProcessEnv = {}) {
  const proc = Bun.spawn(
    [process.execPath, path.resolve(import.meta.dir, "../../../script/dev-isolated.ts"), ...args],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        HOME: root,
        USERPROFILE: root,
        KILO_V2_PROFILE: root,
        KILO_INTERNAL_PROFILE_CUTOVER: "1",
        ...extra,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, code }
}
