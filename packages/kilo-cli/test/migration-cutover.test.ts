import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statfsSync,
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
  const rootConfig = path.join(profile.path, "kilo.jsonc")
  const skills = path.join(worktree, ".kilo", "skills")
  const skill = path.join(skills, "fixture", "SKILL.md")
  mkdirSync(path.dirname(skill), { recursive: true })
  writeFileSync(skill, "---\ndescription: Fixture skill\n---\nPreserve this text.")
  writeFileSync(rootConfig, '{"model":"kilo/fixture"}')
  const ignore = path.join(worktree, ".kilocodeignore")
  const globalIgnore = path.join(profile.path, "home/.kilocode/.kilocodeignore")
  const workflow = path.join(worktree, ".kilocode/workflows/review.md")
  const oldSkill = path.join(worktree, ".kilocode/skills/synthetic/SKILL.md")
  for (const file of [ignore, globalIgnore, workflow, oldSkill]) {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, "synthetic-private/**\n!synthetic-private/public.md\n")
  }
  const oldBytes = readFileSync(source)
  const blocked = await run("migrate", "apply", "--accept-jetbrains-breakage")
  expect(blocked.code).not.toBe(0)
  for (const file of [ignore, globalIgnore, path.dirname(workflow), path.dirname(path.dirname(oldSkill))])
    expect(blocked.stderr).toContain(file)
  for (const file of [ignore, globalIgnore, workflow, oldSkill]) unlinkSync(file)
  // An empty skill bundle is still a legacy resource until it is moved out of discovery.
  renameSync(path.join(worktree, ".kilocode"), path.join(worktree, "archived-legacy-resources"))
  expect(readFileSync(source)).toEqual(oldBytes)
  expect(statSync(source, { bigint: true }).mtimeNs).toBe(before)
  expect(existsSync(`${source}.pre-v2`)).toBe(false)
  expect(existsSync(path.join(data, ".kilo-migration"))).toBe(false)
  expect(readFileSync(skill, "utf8")).toContain("Preserve this text.")
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
  if (!supportedVolume(profile.path)) {
    expect(failed.code).not.toBe(0)
    expect(failed.stderr).toContain("Safe database replacement requires local")
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
  const input = path.join(profile.path, "home/.kilo/workflows/check.md")
  const target = path.join(profile.path, "config/kilo/command/check.md")
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
  const journal = path.join(profile.path, "data/kilo/.kilo-migration", path.basename(source), "stage.json")
  const foreign = path.join(data, ".kilo-cutover-ZZZZZZ")
  mkdirSync(foreign)
  writeFileSync(path.join(foreign, "keep"), "not owned by this run")
  // Kill the actual converter at two real filesystem boundaries. Neither finally block runs.
  for (const name of ["converted.db", path.basename(source) + ".pre-v2"]) {
    writeFileSync(
      path.join(profile.path, "crash.ts"),
      `import fs from 'node:fs';import path from 'node:path';const link=fs.linkSync;fs.linkSync=(src,dest)=>{link(src,dest);if(path.basename(String(dest))===${JSON.stringify(name)}) process.kill(process.pid,'SIGKILL')}`,
    )
    const previous = existsSync(journal) ? JSON.parse(readFileSync(journal, "utf8")).name : undefined
    const crash = await runHost(profile.path, ["migrate", "recover", "--accept-jetbrains-breakage"], {
      BUN_OPTIONS: "--preload ./crash.ts",
    })
    expect(existsSync(journal), crash.stderr).toBe(true)
    const owned = JSON.parse(readFileSync(journal, "utf8"))
    expect(existsSync(path.join(data, owned.name, "converted.db"))).toBe(true)
    if (previous) expect(existsSync(path.join(data, previous))).toBe(false)
    if (owned.linking) expect(statSync(source).ino).toBe(statSync(`${source}.pre-v2`).ino)
    expect(owned.linking).toBe(name.endsWith(".pre-v2"))
    expect(existsSync(target)).toBe(false)
    if (!owned.linking) {
      const dir = path.join(data, owned.name)
      renameSync(dir, dir + ".saved")
      mkdirSync(dir, { mode: 0o700 })
      writeFileSync(path.join(dir, "keep"), "different inode")
      expect((await run("migrate", "recover", "--accept-jetbrains-breakage")).stderr).toContain(
        "Staging directory was replaced",
      )
      expect(readFileSync(path.join(dir, "keep"), "utf8")).toBe("different inode")
      renameSync(dir, dir + ".unrelated")
      renameSync(dir + ".saved", dir)
    }
  }
  const last = JSON.parse(readFileSync(journal, "utf8")).name
  const applied = await run("migrate", "recover", "--accept-jetbrains-breakage")
  expect(applied.code, applied.stderr).toBe(0)
  expect(existsSync(path.join(data, last))).toBe(false)
  expect(existsSync(journal)).toBe(false)
  expect(readFileSync(path.join(foreign, "keep"), "utf8")).toBe("not owned by this run")
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
  expect(readFileSync(target, "utf8")).toContain("Synthetic instructions")
  const checked = await run("migrate", "preflight")
  expect(JSON.parse(checked.stdout).status).toBe("completed")
  const alternate = path.join(profile.path, "client-b")
  mkdirSync(alternate)
  writeFileSync(path.join(alternate, ".kilocodeignore"), '{"permission":{"bash":"deny"}}')
  for (const args of [
    ["migrate", "preflight"],
    ["migrate", "observe"],
    ["debug", "paths"],
  ]) {
    const other = await runHost(profile.path, args, { INIT_CWD: alternate })
    expect(other.code).not.toBe(0)
    expect(other.stderr).toContain(path.join(alternate, ".kilocodeignore"))
    expect(other.stdout).not.toContain('"status":"completed"')
  }
  writeFileSync(path.join(profile.path, "second.ts"), `process.env.KILO_CONFIG_DIR=${JSON.stringify(alternate)}`)
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
  unlinkSync(path.join(alternate, ".kilocodeignore"))
  // Simulate exit after the durable rename but before the owner published its terminal status.
  const otherDB = path.join(alternate, "other.db")
  {
    using db = new Database(otherDB)
    db.exec("CREATE TABLE session_v2(id TEXT PRIMARY KEY); INSERT INTO session_v2 VALUES ('ses_other_client')")
  }
  writeFileSync(path.join(profile.path, "second.ts"), `process.env.KILO_DB = ${JSON.stringify(otherDB)}`)
  const otherDbBoot = await runHost(profile.path, ["debug", "paths"], { BUN_OPTIONS: "--preload ./second.ts" })
  expect(otherDbBoot.code).not.toBe(0)
  expect(otherDbBoot.stderr).toContain(otherDB)
  const state = path.join(profile.path, "data/kilo/.kilo-migration", path.basename(source), "state.json")
  writeFileSync(state, JSON.stringify({ status: "running", phase: "Publishing database and recovery file" }))
  unlinkSync(target)
  writeFileSync(input, "Changed after publication")
  expect((await run("migrate", "recover", "--accept-jetbrains-breakage")).stderr).toContain("resources differ")
  expect(existsSync(target)).toBe(false)
  writeFileSync(input, "Synthetic instructions")
  expect(JSON.parse((await run("migrate", "preflight")).stdout).status).toBe("interrupted")
  const recovered = await run("migrate", "recover", "--accept-jetbrains-breakage")
  expect(recovered.code, recovered.stderr).toBe(0)
  expect(readFileSync(target, "utf8")).toContain("Synthetic instructions")
  expect(JSON.parse(recovered.stdout)).toMatchObject({ status: "completed", phase: "Recovery verified" })
  const boot = await run("debug", "paths")
  expect(boot.code, boot.stderr).toBe(0)
  expect(boot.stdout).toContain(source)
}, 90_000)

test.each([
  { variable: "KILO_CONFIG_DIR", name: "kilo.json", preview: false },
  { variable: "OPENCODE_CONFIG_DIR", name: "kilo.json", preview: true },
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
      legacyConfig: path.dirname(override),
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

test("a linked worktree session and its stable Agent Manager associations survive cutover", async () => {
  await using fixture = await tmpdir()
  const root = fixture.path
  const repo = path.join(root, "primary")
  const tree = path.join(repo, ".kilo/worktrees/feature")
  const source = path.join(root, "data/kilo/kilo.db")
  const legacy = path.join(repo, ".kilo/agent-manager.json")
  for (const dir of [repo, path.dirname(source), path.dirname(legacy)]) mkdirSync(dir, { recursive: true })
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
  writeFileSync(legacy, manager)
  {
    using db = new Database(source)
    db.exec(readFileSync(path.join(import.meta.dir, "fixture/kilo-v1-schema.sql"), "utf8"))
    db.run("INSERT INTO project (id,worktree,time_created,time_updated,sandboxes) VALUES ('global','/',1,1,'[]')")
    db.run(
      "INSERT INTO session (id,project_id,slug,directory,title,version,time_created,time_updated) VALUES ('ses_manager','global','manager',?,'Agent Manager fixture','7',1,1)",
      [tree],
    )
  }
  const result = await runHost(root, ["migrate", "apply", "--accept-jetbrains-breakage"])
  if (!supportedVolume(root)) {
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain("Safe database replacement requires local")
    return
  }
  expect(result.code, result.stderr).toBe(0)
  using active = new Database(source, { readonly: true })
  expect(active.query("SELECT id FROM session_v2").get()).toEqual({ id: "ses_manager" })
  expect(readFileSync(legacy, "utf8")).toBe(manager)
  expect(existsSync(path.join(tree, ".git"))).toBe(true)
}, 30_000)

test("fallback state survives cutover and inherited release paths select the same receipt", async () => {
  await using p = await tmpdir()
  const root = p.path
  for (const dir of [".git", "data/kilo/state", "data/kilo/kilo"]) mkdirSync(path.join(root, dir), { recursive: true })
  {
    using db = new Database(path.join(root, "data/kilo/kilo.db"))
    db.exec(readFileSync(path.join(import.meta.dir, "fixture/kilo-v1-schema.sql"), "utf8"))
  }
  const config = path.join(root, "data/kilo/state/model.json")
  const prefs = JSON.stringify({
    model: { code: { providerID: "demo", modelID: "preserved" } },
    variant: { "demo/preserved": "high" },
  })
  writeFileSync(config, prefs)
  writeFileSync(
    path.join(root, "state-env.ts"),
    `if(!process.env.KILO_INTERNAL_CUTOVER_IMPLICIT_STATE)delete process.env.XDG_STATE_HOME`,
  )
  const env = { BUN_OPTIONS: "--preload ./state-env.ts" }
  const probe = JSON.parse((await runHost(root, ["migrate", "preflight"], env)).stdout)
  expect(probe).toMatchObject({
    v1State: path.dirname(config),
    legacyState: path.join(root, "data/kilo/kilo"),
  })
  const preview = path.join(probe.legacyState, "model.json")
  writeFileSync(preview, '{"model":{}}')
  const blocked = await runHost(root, ["migrate", "apply", "--accept-jetbrains-breakage"], env)
  expect(blocked.stderr).toContain(config)
  expect(blocked.stderr).toContain(preview)
  writeFileSync(preview, prefs)
  const migrated = await runHost(root, ["migrate", "recover", "--accept-jetbrains-breakage"], env)
  if (!supportedVolume(root)) {
    expect(migrated.code).not.toBe(0)
    expect(migrated.stderr).toContain("Safe database replacement requires local")
    return
  }
  expect(migrated.code, migrated.stderr).toBe(0)
  const boot = await runHost(root, ["debug", "paths"], env)
  expect(boot.code, boot.stderr).toBe(0)
  const state = /^state\s+(.+)$/m.exec(boot.stdout)?.[1]?.trim()
  expect(state).toBe(probe.legacyState)
  expect(readFileSync(path.join(state!, "model.json"), "utf8")).toBe(prefs)
  expect(readFileSync(config, "utf8")).toBe(prefs)
}, 30_000)

test("recovery copy without an owner journal refuses startup before opening the store", async () => {
  await using p = await tmpdir()
  const root = p.path
  mkdirSync(path.join(root, ".git"))
  const source = path.join(root, "data/kilo/kilo.db")
  mkdirSync(path.dirname(source), { recursive: true })
  {
    using db = new Database(source)
    db.exec(readFileSync(path.join(import.meta.dir, "fixture/kilo-v1-schema.sql"), "utf8"))
  }
  writeFileSync(`${source}.pre-v2`, "orphaned recovery")
  const probe = await runHost(root, ["migrate", "preflight"])
  expect(probe.code).not.toBe(0)
  expect(probe.stderr).toContain(`Recovery copy exists without matching migration state: ${source}.pre-v2`)
})

function supportedVolume(root: string) {
  if (process.platform === "darwin") return Bun.spawnSync(["/bin/df", "-t", "apfs", root]).exitCode === 0
  return process.platform === "linux" && [0xef53, 0x58465342, 0x9123683e].includes(statfsSync(root).type >>> 0)
}

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
