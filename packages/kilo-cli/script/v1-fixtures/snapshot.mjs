// v1 fixture child: snapshot seed, materialize, lock, cleanup, retention, restore and diff (U-E2-04). See v1.mjs.
import path from "node:path"
import fs from "node:fs/promises"
import os from "node:os"
import { effect, source, url, write } from "./v1.mjs"

const { Effect, Exit, Cause, Layer, Data } = await effect()
const { ChildProcess, ChildProcessSpawner } = await import(
  url("packages/opencode/node_modules/effect/dist/unstable/process/index.js")
)
const { Hash } = await source("packages/core/src/util/hash.ts")
const { EffectFlock } = await source("packages/core/src/util/effect-flock.ts")
const { FSUtil } = await source("packages/core/src/fs-util.ts")
const { AppProcess } = await source("packages/core/src/process.ts")
const { LayerNode } = await source("packages/core/src/effect/layer-node.ts")
const { AppNodeBuilder } = await source("packages/core/src/effect/app-node-builder.ts")
const { CrossSpawnSpawner } = await source("packages/core/src/cross-spawn-spawner.ts")
const { Global } = await source("packages/core/src/global.ts")
// The Kilo snapshot module paths never appear in full, here or in the fixture: the progress map closes the v1 API cell of
// the snapshot prepare route on any tracked file that contains the route path, and these fixtures do not port the route.
const KILO_SNAPSHOT = "packages/opencode/src/kilocode/snapshot"
const kilo = (name) => source(`${KILO_SNAPSHOT}/${name}.ts`)
const { KiloSnapshotMaterialize } = await kilo("materialize")
const { KiloSnapshotPrepare } = await kilo("prepare")
const { KiloSnapshotSeed } = await kilo("seed")
const { KiloSnapshotCleanup } = await kilo("cleanup")
const { KiloSnapshotLock } = await kilo("lock")
const { DiffFull } = await kilo("diff-full")
const { Snapshot } = await source("packages/opencode/src/snapshot/index.ts")
const { InstanceStore } = await source("packages/opencode/src/project/instance-store.ts")
const { InstanceBootstrap } = await source("packages/opencode/src/project/bootstrap-service.ts")

const out = {}
const TMP = await fs.realpath(os.tmpdir())
const scratch = await fs.mkdtemp(path.join(TMP, "v1-snap-"))

// ---------- helpers ----------
const sh = (args, cwd, opts = {}) => {
  const r = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { ...process.env, ...opts.env },
    stdin: opts.stdin ? Buffer.from(opts.stdin) : undefined,
  })
  if (r.exitCode !== 0 && !opts.nothrow) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`)
  return r.stdout.toString()
}
const put = async (file, data) => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, data)
}
const exists = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  )
const fakeGit = (handler) => {
  const calls = []
  const git = (cmd, opts) =>
    Effect.sync(() => {
      calls.push({ cmd, stdin: opts?.stdin })
      return handler(cmd, opts)
    })
  return { git, calls }
}
const realGit = Effect.gen(function* () {
  const proc = yield* AppProcess.Service
  return (cmd, opts) =>
    proc
      .run(ChildProcess.make("git", cmd, { cwd: opts?.cwd, env: opts?.env, extendEnv: true }), { stdin: opts?.stdin })
      .pipe(
        Effect.map((r) => ({
          code: ChildProcessSpawner.ExitCode(r.exitCode),
          text: r.stdout.toString("utf8"),
          stderr: r.stderr.toString("utf8"),
        })),
        Effect.catch((err) => Effect.succeed({ code: ChildProcessSpawner.ExitCode(1), text: "", stderr: String(err) })),
      )
})
const initRepo = (dir) => {
  sh(["init", "-q", "-b", "main"], dir)
  sh(["config", "core.fsmonitor", "false"], dir)
  sh(["config", "commit.gpgsign", "false"], dir)
  sh(["config", "user.email", "test@opencode.test"], dir)
  sh(["config", "user.name", "Test"], dir)
  sh(["config", "core.autocrlf", "false"], dir)
}
const infra = LayerNode.compile(
  LayerNode.group([FSUtil.node, AppProcess.node, EffectFlock.node, CrossSpawnSpawner.node]),
)
const runInfra = (fx) => Effect.runPromise(fx.pipe(Effect.provide(infra)))

// ---------- 1. pure constants and decisions ----------
{
  const prev = process.env.KILO_SNAPSHOT_MATERIALIZE_IDLE_MS
  const idle = {}
  for (const v of [undefined, "0", "2500", "-1", "abc", ""]) {
    if (v === undefined) delete process.env.KILO_SNAPSHOT_MATERIALIZE_IDLE_MS
    else process.env.KILO_SNAPSHOT_MATERIALIZE_IDLE_MS = v
    idle[v === undefined ? "<unset>" : JSON.stringify(v)] = KiloSnapshotMaterialize.idle()
  }
  process.env.KILO_SNAPSHOT_MATERIALIZE_IDLE_MS = prev
  const data = "/home/u/.local/share/kilo"
  const state = "/home/u/.local/state/kilo"
  const worktree = "/work/repo"
  const gitdir = path.join(data, "snapshot", "proj123", Hash.fast(worktree))
  out.pure = {
    constants: {
      PREPARE_MARKER: KiloSnapshotPrepare.MARKER,
      MAX_DIFF_SIZE: Snapshot.MAX_DIFF_SIZE,
      DIFF_MAX_DETAIL_SIZE: DiffFull.MAX_DETAIL_SIZE,
    },
    idle,
    layout: {
      input: { data, state, projectID: "proj123", worktree },
      gitdir,
      materializeRef: KiloSnapshotMaterialize.ref(gitdir),
      materializeRefOfTrailingSlash: KiloSnapshotMaterialize.ref(gitdir + "/"),
      lockKey: `snapshot:${gitdir}`,
      lockDir: path.join(state, "locks", Hash.fast(`snapshot:${gitdir}`) + ".lock"),
    },
  }
}

// ---------- 2. retention: prune pins with a fake git ----------
{
  const now = 1_800_000_000_000
  const retention = 7 * 24 * 60 * 60 * 1000
  const before = now - retention
  const refs = [
    `refs/kilo/snapshots/${before - 1}/aaaa`,
    `refs/kilo/snapshots/${before}/bbbb`,
    `refs/kilo/snapshots/${before + 1}/cccc`,
    `refs/kilo/snapshots/1/dddd`,
    `refs/kilo/snapshots/1/NOTHEX`,
    `refs/kilo/snapshots/abc/eeee`,
    `refs/kilo/snapshots/99999999999999999999/ffff`,
    `refs/kilo/snapshots/2/sub/1111`,
  ]
  const cases = []
  for (const c of [
    { name: "mixed", list: refs, listCode: 0, deleteCode: 0 },
    { name: "none-expired", list: [`refs/kilo/snapshots/${now}/abcd`], listCode: 0, deleteCode: 0 },
    { name: "list-fails", list: [], listCode: 128, deleteCode: 0 },
    { name: "delete-fails", list: [`refs/kilo/snapshots/5/abcd`], listCode: 0, deleteCode: 1 },
  ]) {
    const f = fakeGit((cmd) =>
      cmd.includes("for-each-ref")
        ? { code: c.listCode, text: c.list.join("\n") + "\n", stderr: "" }
        : { code: c.deleteCode, text: "", stderr: "" },
    )
    const result = await Effect.runPromise(
      KiloSnapshotMaterialize.prune({ gitdir: "/g", git: f.git, fs: undefined }, before),
    )
    cases.push({
      name: c.name,
      input: { before, refs: c.list, listCode: c.listCode, deleteCode: c.deleteCode },
      result,
      commands: f.calls.map((x) => ({ cmd: x.cmd, stdin: x.stdin })),
    })
  }
  out.prune = { retentionMs: retention, gcPrune: "7.days", cases }
}

// ---------- 3. DiffFull.batch parse with a fake git ----------
{
  const text = [
    "diff --git a/lib/a.txt b/lib/a.txt",
    "index 1..2 100644",
    "--- a/lib/a.txt",
    "+++ b/lib/a.txt",
    "@@ -1 +1 @@",
    "-x",
    "+y",
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1 +1 @@",
    "-1",
    "+2",
    'diff --git "a/sp ace\\tq.txt" "b/sp ace\\tq.txt"',
    "@@ -0,0 +1 @@",
    "+q",
    "diff --git a/unlisted.txt b/unlisted.txt",
    "@@ -1 +1 @@",
    "-u",
    "+v",
    "",
  ].join("\n")
  const f = fakeGit(() => ({ code: 0, text, stderr: "" }))
  const map = await Effect.runPromise(
    DiffFull.batch(f.git, "FROM", "TO", ["a.txt", "lib/a.txt", "sp ace\\tq.txt", "missing.txt"]),
  )
  const fail = fakeGit(() => ({ code: 1, text: "", stderr: "boom" }))
  const failed = await Effect.runPromise(DiffFull.batch(fail.git, "FROM", "TO", ["a.txt"]))
  const empty = fakeGit(() => ({ code: 0, text: "", stderr: "" }))
  const none = await Effect.runPromise(DiffFull.batch(empty.git, "FROM", "TO", []))
  out.diffBatch = {
    command: f.calls[0].cmd,
    result: Object.fromEntries(map),
    onGitFailure: Object.fromEntries(failed),
    emptyFilesCalls: empty.calls.length,
    emptyFilesResult: Object.fromEntries(none),
  }
}

// ---------- 4. lock error classification ----------
{
  class SomeError extends Data.TaggedError("SomeError") {}
  const classify = async (fx) => {
    const exit = await Effect.runPromiseExit(KiloSnapshotLock.dieOnLockError(fx))
    if (Exit.isSuccess(exit)) return { exit: "success", value: exit.value }
    return { exit: Cause.hasDies(exit.cause) ? "die" : Cause.hasFails(exit.cause) ? "fail" : "other" }
  }
  out.lock = {
    LockTimeoutError: await classify(Effect.fail(new EffectFlock.LockTimeoutError({ key: "snapshot:/g" }))),
    LockCompromisedError: await classify(Effect.fail(new EffectFlock.LockCompromisedError({ detail: "x" }))),
    bodyError: await classify(Effect.fail(new SomeError())),
    success: await classify(Effect.succeed("ok")),
  }
  // Real lock: the lock directory layout under Global state while held.
  const held = await runInfra(
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const dir = path.join(scratch, "locks")
      return yield* flock.withLock(
        Effect.promise(async () => {
          const lockDir = path.join(dir, Hash.fast("snapshot:/g") + ".lock")
          const meta = JSON.parse(await fs.readFile(path.join(lockDir, "meta.json"), "utf8"))
          return { entries: (await fs.readdir(lockDir)).sort(), metaKeys: Object.keys(meta).sort() }
        }),
        "snapshot:/g",
        dir,
      )
    }),
  )
  out.lock.heldLayout = { ...held, afterRelease: await fs.readdir(path.join(scratch, "locks")) }
}

// ---------- 5. cleanup.remove decisions on a real filesystem ----------
{
  const tree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
  const base = path.join(scratch, "cleanup")
  const item = (name, project = "project") => {
    const directory = path.join(base, name, "project")
    return {
      root: path.join(base, name, "snapshots"),
      project,
      directory,
      worktree: path.join(directory, ".kilo", "worktrees", "wt"),
    }
  }
  const repo = async (input) => {
    const dir = path.join(input.root, input.project, Hash.fast(input.worktree))
    await fs.mkdir(dir, { recursive: true })
    await fs.mkdir(input.worktree, { recursive: true })
    sh(["init", "-q"], input.directory, { env: { GIT_DIR: dir, GIT_WORK_TREE: input.worktree } })
    const commit = sh(
      ["--git-dir", dir, "-c", "user.email=t@t", "-c", "user.name=T", "commit-tree", tree, "-m", "s"],
      input.directory,
    ).trim()
    sh(["--git-dir", dir, "update-ref", "HEAD", commit], input.directory)
    return dir
  }
  const remove = (input) =>
    runInfra(
      Effect.gen(function* () {
        const fsu = yield* FSUtil.Service
        const flock = yield* EffectFlock.Service
        return yield* KiloSnapshotCleanup.remove({ ...input, fs: fsu, flock }).pipe(Effect.exit)
      }),
    ).then((exit) =>
      Exit.isSuccess(exit)
        ? { ok: true, value: exit.value }
        : { ok: false, error: String(Cause.squash(exit.cause)?.message ?? Cause.pretty(exit.cause)) },
    )
  const cases = []
  // removed worktree, plain repo
  {
    const input = item("plain")
    const dir = await repo(input)
    await fs.rm(input.worktree, { recursive: true })
    const r = await remove(input)
    cases.push({
      name: "worktree-gone-plain-repo",
      result: r,
      repoExistsAfter: await exists(dir),
      siblingsAfter: await fs.readdir(path.dirname(dir)),
    })
  }
  // live worktree
  {
    const input = item("live")
    const dir = await repo(input)
    cases.push({ name: "worktree-live", result: await remove(input), repoExistsAfter: await exists(dir) })
  }
  // absent repository
  {
    const input = item("absent")
    cases.push({ name: "repo-absent", result: await remove(input) })
  }
  // pending markers
  for (const marker of [
    "objects/info/alternates",
    "objects/info/alternates.seed",
    "objects/info/alternates.materializing",
    "seed-objects/part",
    "seed.index",
    "seed.index.lock",
  ]) {
    const input = item("pending-" + marker.replaceAll("/", "-"))
    const dir = await repo(input)
    await fs.rm(input.worktree, { recursive: true })
    await put(path.join(dir, marker), "pending")
    cases.push({ name: `pending:${marker}`, result: await remove(input), repoExistsAfter: await exists(dir) })
  }
  // prepared, never tracked: marker wins over alternates/seed-objects
  {
    const input = item("prepared")
    const dir = await repo(input)
    await fs.rm(input.worktree, { recursive: true })
    await put(path.join(dir, KiloSnapshotPrepare.MARKER), "")
    await put(path.join(dir, "objects/info/alternates"), "pending")
    await put(path.join(dir, "seed-objects/part"), "pending")
    cases.push({
      name: "prepared-marker-with-alternates",
      result: await remove(input),
      repoExistsAfter: await exists(dir),
    })
  }
  // prepared marker + seed.index still blocks
  {
    const input = item("prepared-seedindex")
    const dir = await repo(input)
    await fs.rm(input.worktree, { recursive: true })
    await put(path.join(dir, KiloSnapshotPrepare.MARKER), "")
    await put(path.join(dir, "seed.index"), "")
    cases.push({
      name: "prepared-marker-with-seed.index",
      result: await remove(input),
      repoExistsAfter: await exists(dir),
    })
  }
  // leftover quarantine
  {
    const input = item("quarantine")
    const dir = await repo(input)
    await fs.rm(input.worktree, { recursive: true })
    const q = path.join(path.dirname(dir), `.${path.basename(dir)}.cleanup-${crypto.randomUUID()}`)
    await fs.rename(dir, q)
    const unrelated = path.join(path.dirname(dir), ".other.cleanup-00000000-0000-0000-0000-000000000000")
    const badSuffix = path.join(path.dirname(dir), `.${path.basename(dir)}.cleanup-not-a-uuid`)
    await put(path.join(unrelated, "keep"), "keep")
    await put(path.join(badSuffix, "keep"), "keep")
    const r = await remove(input)
    cases.push({
      name: "interrupted-quarantine",
      result: r,
      after: (await fs.readdir(path.dirname(dir))).map((n) => n.replace(path.basename(dir), "<sha1(worktree)>")).sort(),
    })
  }
  // seed pin release in the project's git dir after a successful remove
  {
    const input = item("pin-release")
    const dir = await repo(input)
    await fs.rm(input.worktree, { recursive: true })
    initRepo(input.directory)
    await put(path.join(input.directory, "f.txt"), "f\n")
    sh(["add", "f.txt"], input.directory)
    sh(["commit", "-q", "-m", "f"], input.directory)
    const ref = KiloSnapshotMaterialize.ref(dir)
    sh(["update-ref", ref, "HEAD"], input.directory)
    const r = await remove(input)
    cases.push({
      name: "releases-seed-pin",
      result: r,
      refBefore: ref.replace(/[0-9a-f]{40}$/, "<sha1(resolve(gitdir))>"),
      refAfter: sh(["for-each-ref", "--format=%(refname)", "refs/kilo/materialize"], input.directory).trim(),
    })
  }
  // input validation
  for (const project of ["", ".", "..", "project/name", "-dash", "ok_.-1"]) {
    const input = item("project-" + Math.random().toString(36).slice(2), project)
    cases.push({ name: `project-component:${JSON.stringify(project)}`, result: await remove(input) })
  }
  for (const wt of ["", "a/b", ".hidden", "ok-1"]) {
    const input = item("wt-" + Math.random().toString(36).slice(2))
    input.worktree = path.join(input.directory, ".kilo", "worktrees", wt)
    cases.push({ name: `worktree-component:${JSON.stringify(wt)}`, result: await remove(input) })
  }
  {
    const input = item("outside")
    input.worktree = path.join(input.directory, ".kilo", "worktrees-evil", "x")
    cases.push({ name: "worktree-outside-managed", result: await remove(input) })
    const rel = item("relative")
    rel.worktree = ".kilo/worktrees/x"
    cases.push({ name: "worktree-relative", result: await remove(rel) })
  }
  out.cleanup = cases
}

// ---------- 6. seed decisions (KiloSnapshotSeed.seed on a bare snapshot gitdir) ----------
{
  const seedCase = async (name, prepare, opts = {}) => {
    const dir = path.join(scratch, "seed", name)
    await fs.mkdir(dir, { recursive: true })
    initRepo(dir)
    await prepare(dir)
    const gitdir = path.join(scratch, "seed", name + ".snapshot")
    sh(["init", "-q", "--bare", gitdir], scratch)
    const sessionDir = opts.sub ? path.join(dir, opts.sub) : dir
    const indexPath = sh(["rev-parse", "--path-format=absolute", "--git-path", "index"], dir).trim()
    const indexBefore = (await exists(indexPath)) ? await fs.readFile(indexPath) : undefined
    // The seed only logs its decision; capture the log line to record it.
    const logged = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk, ...rest) => {
      logged.push(String(chunk))
      return original(chunk, ...rest)
    }
    const result = await runInfra(
      Effect.gen(function* () {
        const git = yield* realGit
        const fsu = yield* FSUtil.Service
        return yield* KiloSnapshotSeed.seed({
          dir: sessionDir,
          worktree: dir,
          gitdir,
          limit: 2 * 1024 * 1024,
          git,
          fs: fsu,
        })
      }),
    ).finally(() => {
      process.stderr.write = original
    })
    const line =
      logged
        .join("")
        .split("\n")
        .find((l) => l.includes("service=snapshot.seed")) ?? ""
    const rel = (p) =>
      p
        ? path
            .relative(scratch, p)
            .split(path.sep)
            .join("/")
            .replace(name + ".snapshot", "<gitdir>")
            .replace(name, "<repo>")
        : p
    const record = { name, sourceReturned: Boolean(result.source) }
    record.log = {
      reason: line.match(/reason=(\S+)/)?.[1] ?? null,
      trusted: line.match(/trusted=(\S+)/)?.[1] ?? null,
      shared: line.match(/shared=(\S+)/)?.[1] ?? null,
      paths: line.match(/ paths=(\d+)/)?.[1] ?? null,
      dropped: line.match(/dropped=(\d+)/)?.[1] ?? null,
      reset: line.match(/ reset=(\d+)/)?.[1] ?? null,
    }
    const indexAfter = (await exists(indexPath)) ? await fs.readFile(indexPath) : undefined
    record.userIndexUnchanged =
      indexBefore === undefined ? indexAfter === undefined : Buffer.compare(indexBefore, indexAfter) === 0
    record.gitdirEntries = (await fs.readdir(gitdir))
      .filter((n) => !["hooks", "description", "HEAD", "config", "refs", "info", "branches"].includes(n))
      .sort()
    if (result.source) {
      const common = sh(["rev-parse", "--path-format=absolute", "--git-common-dir"], dir).trim()
      record.source = { gitdir: rel(result.source.gitdir), staging: rel(result.source.staging) }
      record.hashEqualsSourceIndexTree = result.source.hash === sh(["write-tree"], dir).trim()
      record.alternates = (await fs.readFile(path.join(gitdir, "objects/info/alternates"), "utf8"))
        .split("\n")
        .filter(Boolean)
        .map(rel)
      const pinRef = sh(
        ["--git-dir", common, "for-each-ref", "--format=%(refname)", "refs/kilo/materialize"],
        dir,
      ).trim()
      record.pinRef = pinRef.replace(/[0-9a-f]{40}$/, "<sha1(resolve(gitdir))>")
      record.pinRefMatches = pinRef === KiloSnapshotMaterialize.ref(gitdir)
      record.pinTargetIsSeedTree = sh(["--git-dir", common, "rev-parse", pinRef], dir).trim() === result.source.hash
      record.snapshotIndex = sh(["--git-dir", gitdir, "ls-files", "-s"], dir)
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => l.replace(/ [0-9a-f]{40} /, " <oid> "))
      record.statDirty = sh(["--git-dir", gitdir, "--work-tree", dir, "diff-files", "--name-only"], dir)
        .trim()
        .split("\n")
        .filter(Boolean)
        .sort()
    }
    return record
  }
  const base = async (dir) => {
    await put(path.join(dir, "plain.txt"), "plain\n")
    await put(path.join(dir, "tracked.log"), "tracked but ignored\n")
    await put(path.join(dir, "huge.bin"), new Uint8Array(2 * 1024 * 1024 + 1))
    await put(path.join(dir, "assume.txt"), "assume\n")
    await put(path.join(dir, "nested/n.txt"), "nested\n")
    sh(["add", "."], dir)
    sh(["commit", "-q", "-m", "base"], dir)
    await put(path.join(dir, ".gitignore"), "*.log\n")
    sh(["add", ".gitignore"], dir)
    sh(["commit", "-q", "-m", "ignore"], dir)
    sh(["update-index", "--assume-unchanged", "assume.txt"], dir)
    sh(["status", "--porcelain"], dir)
  }
  const cases = []
  cases.push(await seedCase("trusted-primary", base))
  cases.push(
    await seedCase("autocrlf-true-cold", async (dir) => {
      await base(dir)
      sh(["config", "core.autocrlf", "true"], dir)
    }),
  )
  cases.push(await seedCase("subdirectory-session", base, { sub: "nested" }))
  cases.push(
    await seedCase("sparse-checkout", async (dir) => {
      await base(dir)
      sh(["config", "core.sparseCheckout", "true"], dir)
    }),
  )
  cases.push(
    await seedCase("unmerged-index", async (dir) => {
      await put(path.join(dir, "c.txt"), "base\n")
      sh(["add", "."], dir)
      sh(["commit", "-q", "-m", "b"], dir)
      sh(["checkout", "-q", "-b", "other"], dir)
      await put(path.join(dir, "c.txt"), "other\n")
      sh(["commit", "-q", "-am", "o"], dir)
      sh(["checkout", "-q", "main"], dir)
      await put(path.join(dir, "c.txt"), "main\n")
      sh(["commit", "-q", "-am", "m"], dir)
      sh(["merge", "-q", "other"], dir, { nothrow: true })
    }),
  )
  cases.push(await seedCase("no-index-yet", async () => {}))
  cases.push(
    await seedCase("sha256-source-object-format", async (dir) => {
      await fs.rm(path.join(dir, ".git"), { recursive: true })
      sh(["init", "-q", "--object-format=sha256", "-b", "main"], dir)
      sh(["config", "user.email", "t@t"], dir)
      sh(["config", "user.name", "T"], dir)
      sh(["config", "core.autocrlf", "false"], dir)
      await put(path.join(dir, "x.txt"), "x\n")
      sh(["add", "."], dir)
      sh(["commit", "-q", "-m", "x"], dir)
    }),
  )
  cases.push(
    await seedCase("filter-driver-not-shared", async (dir) => {
      sh(["config", "filter.up.clean", "tr a-z A-Z"], dir)
      sh(["config", "filter.up.smudge", "cat"], dir)
      await put(path.join(dir, ".gitattributes"), "*.flt filter=up\n")
      await put(path.join(dir, "f.flt"), "filtered\n")
      await put(path.join(dir, "plain.txt"), "plain\n")
      sh(["add", "."], dir)
      sh(["commit", "-q", "-m", "f"], dir)
      sh(["status", "--porcelain"], dir)
    }),
  )
  out.seed = cases
}

// ---------- 7. full Snapshot service: track / patch / diffFull / diff / revert / restore / cleanup ----------
{
  const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
  const storeLayer = LayerNode.compile(InstanceStore.node, [[InstanceStore.bootstrapNode, noopBootstrap]])
  const run = (dir, body) =>
    Effect.runPromise(
      Snapshot.Service.use(body).pipe(
        (self) => InstanceStore.Service.use((store) => store.provide({ directory: dir }, self)),
        Effect.provide(AppNodeBuilder.build(Snapshot.node)),
        Effect.provide(storeLayer),
      ),
    )
  const dir = path.join(scratch, "service", "repo")
  await fs.mkdir(dir, { recursive: true })
  initRepo(dir)
  await put(path.join(dir, "a.txt"), "one\ntwo\nthree\n")
  await put(path.join(dir, "b.txt"), "move me\n")
  await put(path.join(dir, "dir/c.txt"), "delete me\n")
  await put(path.join(dir, "bin.dat"), new Uint8Array([0, 1, 2, 3]))
  await put(path.join(dir, ".gitignore"), "*.log\n")
  sh(["add", "."], dir)
  sh(["commit", "-q", "-m", "init"], dir)
  await put(path.join(dir, "dirty-untracked.txt"), "untracked before\n")
  await put(path.join(dir, "ignored.log"), "ignored\n")

  const rel = (files) => files.map((f) => path.relative(dir, f).split(path.sep).join("/")).sort()
  // Files map to content; directories map to "<dir>" so empty directories stay visible.
  const listing = async () => {
    const walk = async (d) =>
      (
        await Promise.all(
          (await fs.readdir(d, { withFileTypes: true }))
            .filter((e) => e.name !== ".git")
            .map(async (e) =>
              e.isDirectory()
                ? [[path.join(d, e.name), true], ...(await walk(path.join(d, e.name)))]
                : [[path.join(d, e.name), false]],
            ),
        )
      ).flat()
    const entries = await walk(dir)
    return Object.fromEntries(
      await Promise.all(
        entries
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(async ([f, isDir]) => {
            const key = path.relative(dir, f).split(path.sep).join("/")
            if (isDir) return [key + "/", "<dir>"]
            const buf = await fs.readFile(f)
            return [key, buf.length > 64 || buf.includes(0) ? `<${buf.length} bytes>` : buf.toString("utf8")]
          }),
      ),
    )
  }
  const svc = {}
  svc.before = await run(dir, (s) => s.track())
  svc.trackAgainSameHash = (await run(dir, (s) => s.track())) === svc.before
  // edit, rename, delete, add, binary change, huge add, nested add
  await put(path.join(dir, "a.txt"), "one\nTWO\nthree\nfour\n")
  await fs.mkdir(path.join(dir, "moved"), { recursive: true })
  await fs.rename(path.join(dir, "b.txt"), path.join(dir, "moved/b.txt"))
  await fs.rm(path.join(dir, "dir/c.txt"))
  await put(path.join(dir, "new.txt"), "brand new\n")
  await put(path.join(dir, "bin.dat"), new Uint8Array([0, 9, 9, 9, 9]))
  await put(path.join(dir, "huge.bin"), new Uint8Array(2 * 1024 * 1024 + 1))
  await put(path.join(dir, "other.log"), "ignored too\n")
  const patch = await run(dir, (s) => s.patch(svc.before))
  svc.patchFiles = rel(patch.files)
  svc.patchHashIsBefore = patch.hash === svc.before
  svc.after = await run(dir, (s) => s.track())
  const full = await run(dir, (s) => s.diffFull(svc.before, svc.after))
  svc.diffFull = full.map((d) => ({
    file: d.file,
    status: d.status,
    additions: d.additions,
    deletions: d.deletions,
    patch: d.patch.replace(/^index [0-9a-f]+\.\.[0-9a-f]+( \d+)?$/gm, "index <oids>$1"),
  }))
  svc.diffFullSame = await run(dir, (s) => s.diffFull(svc.before, svc.before))
  const detail = await run(dir, (s) => s.diffFile(svc.before, svc.after, "a.txt"))
  svc.diffFileA = {
    ...detail,
    patch: detail.patch.replace(/^index [0-9a-f]+\.\.[0-9a-f]+( \d+)?$/gm, "index <oids>$1"),
  }
  const detailBin = await run(dir, (s) => s.diffFile(svc.before, svc.after, "bin.dat"))
  svc.diffFileBin = detailBin
  svc.diffFileUnchanged = (await run(dir, (s) => s.diffFile(svc.before, svc.after, "dirty-untracked.txt"))) ?? null
  svc.diffText = (await run(dir, (s) => s.diff(svc.before))).replace(
    /^index [0-9a-f]+\.\.[0-9a-f]+( \d+)?$/gm,
    "index <oids>$1",
  )
  svc.worktreeBeforeRevert = await listing()
  await run(dir, (s) => s.revert([patch]))
  svc.worktreeAfterRevert = await listing()

  // restore: read-tree + checkout-index -a -f, extra files survive
  await put(path.join(dir, "a.txt"), "changed again\n")
  await fs.rm(path.join(dir, "moved/b.txt")).catch(() => {})
  await put(path.join(dir, "restore-extra.txt"), "extra\n")
  await run(dir, (s) => s.restore(svc.after))
  svc.worktreeAfterRestoreToAfter = await listing()

  // revert of an unavailable hash dies before any file changes; empty file lists skip validation
  const badRevert = await Effect.runPromiseExit(
    Snapshot.Service.use((s) => s.revert([{ hash: "0".repeat(40), files: [path.join(dir, "a.txt")] }])).pipe(
      (self) => InstanceStore.Service.use((store) => store.provide({ directory: dir }, self)),
      Effect.provide(AppNodeBuilder.build(Snapshot.node)),
      Effect.provide(storeLayer),
    ),
  )
  svc.revertUnavailable = Exit.isSuccess(badRevert)
    ? "success"
    : String(Cause.squash(badRevert.cause)?.message).replace(/[0-9a-f]{40}/, "<hash>")
  svc.revertEmptyFilesSkipsValidation = await run(dir, (s) => s.revert([{ hash: "0".repeat(40), files: [] }])).then(
    () => "success",
    (e) => String(e),
  )

  // repository layout + materialization + cleanup
  const ctx = await Effect.runPromise(
    InstanceStore.Service.use((store) => store.load({ directory: dir })).pipe(Effect.provide(storeLayer)),
  )
  const gitdir = path.join(Global.Path.data, "snapshot", ctx.project.id, Hash.fast(dir))
  const deadline = Date.now() + 30000
  while (
    Date.now() < deadline &&
    ((await exists(path.join(gitdir, "objects/info/alternates"))) ||
      (await exists(path.join(gitdir, "objects/info/alternates.materializing"))))
  )
    await Bun.sleep(50)
  svc.layout = {
    gitdirIsDataSnapshotProjectSha1Worktree: await exists(gitdir),
    dataDirUnderXdgData: path.relative(process.env.XDG_DATA_HOME ?? "", Global.Path.data),
    entries: (await fs.readdir(gitdir)).sort(),
    alternatesAfterMaterialize: await exists(path.join(gitdir, "objects/info/alternates")),
    seedObjectsAfterMaterialize: await exists(path.join(gitdir, "seed-objects")),
    // git init writes platform lines (ignorecase, precomposeunicode); keep only the block Kilo appends after them.
    kiloConfig: ((lines) => lines.slice(lines.lastIndexOf("[core]")))(
      (await fs.readFile(path.join(gitdir, "config"), "utf8")).split("\n").filter(Boolean),
    ),
    infoExclude: (await fs.readFile(path.join(gitdir, "info/exclude"), "utf8"))
      .split("\n")
      .filter((line) => line && !line.startsWith("#")),
    snapshotRefs: sh(["--git-dir", gitdir, "for-each-ref", "--format=%(refname)"], dir)
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((r) =>
        r
          .replace(/\/\d{13}\//, "/<ms>/")
          .replace(/[0-9a-f]{40}$/, (h) => (h === svc.before ? "<before>" : h === svc.after ? "<after>" : "<other>")),
      )
      .sort(),
    sourcePinRemaining: sh(["for-each-ref", "refs/kilo/materialize"], dir).trim(),
  }
  // Retention: pins older than now - 7 days are deleted by cleanup(), newer ones stay.
  const now = Date.now()
  const labels = new Map([
    ["1", "<epoch+1ms>"],
    [String(now - 7 * 86400000 - 60000), "<now-7d-1min>"],
    [String(now - 7 * 86400000 + 60000), "<now-7d+1min>"],
  ])
  for (const t of labels.keys())
    sh(["--git-dir", gitdir, "update-ref", `refs/kilo/snapshots/${t}/${svc.before}`, svc.before], dir)
  await run(dir, (s) => s.cleanup())
  svc.refsAfterCleanup = sh(["--git-dir", gitdir, "for-each-ref", "--format=%(refname)"], dir)
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((r) =>
      r
        .replace(/\/(\d+)\//, (_, t) => `/${labels.get(t) ?? "<track-ms>"}/`)
        .replace(/[0-9a-f]{40}$/, (h) => (h === svc.before ? "<before>" : h === svc.after ? "<after>" : "<other>")),
    )
    .sort()
  svc.hashes = {
    before: svc.before,
    after: svc.after,
    note: "tree hashes; content-addressed, stable for identical bytes and modes",
  }
  delete svc.before
  delete svc.after
  out.service = svc
}

await fs.rm(scratch, { recursive: true, force: true })

const service = out.service
const scenario =
  "service: a git repo with a.txt, b.txt, dir/c.txt, bin.dat, .gitignore (*.log); then edit a.txt, move b.txt to moved/b.txt, delete dir/c.txt, add new.txt, change bin.dat, add huge.bin (2 MiB + 1) and other.log"
const cases = [
  {
    name: "layout",
    fn: "Hash.fast, KiloSnapshotMaterialize.ref, EffectFlock lock path",
    input: out.pure.layout.input,
    output: out.pure.layout,
  },
  {
    name: "materialize-idle-env",
    fn: "KiloSnapshotMaterialize.idle (KILO_SNAPSHOT_MATERIALIZE_IDLE_MS)",
    input: Object.keys(out.pure.idle),
    output: out.pure.idle,
  },
  ...out.prune.cases.map(({ name, input, ...output }) => ({
    name: `prune/${name}`,
    fn: "KiloSnapshotMaterialize.prune (fake git)",
    input,
    output,
  })),
  {
    name: "diff-batch",
    fn: "DiffFull.batch (fake git)",
    input: ["a.txt", "lib/a.txt", "sp ace\\tq.txt", "missing.txt"],
    output: out.diffBatch,
  },
  ...["LockTimeoutError", "LockCompromisedError", "bodyError", "success"].map((name) => ({
    name: `lock/${name}`,
    fn: "KiloSnapshotLock.dieOnLockError",
    input: name,
    output: out.lock[name],
  })),
  { name: "lock/held-layout", fn: "EffectFlock.withLock", input: "snapshot:/g", output: out.lock.heldLayout },
  ...out.cleanup.map(({ name, ...output }) => ({
    name: `cleanup/${name}`,
    fn: "KiloSnapshotCleanup.remove",
    input: name,
    output,
  })),
  ...out.seed.map(({ name, ...output }) => ({
    name: `seed/${name}`,
    fn: "KiloSnapshotSeed.seed",
    input: name,
    output,
  })),
  {
    name: "service/track-patch",
    fn: "Snapshot.track, Snapshot.patch",
    input: scenario,
    output: {
      trackAgainSameHash: service.trackAgainSameHash,
      patchFiles: service.patchFiles,
      patchHashIsBefore: service.patchHashIsBefore,
    },
  },
  {
    name: "service/diff-full",
    fn: "Snapshot.diffFull",
    input: scenario,
    output: { changed: service.diffFull, same: service.diffFullSame },
  },
  {
    name: "service/diff-file",
    fn: "Snapshot.diffFile",
    input: scenario,
    output: { text: service.diffFileA, binary: service.diffFileBin, unchanged: service.diffFileUnchanged },
  },
  { name: "service/diff-text", fn: "Snapshot.diff", input: scenario, output: service.diffText },
  {
    name: "service/revert",
    fn: "Snapshot.revert",
    input: scenario,
    output: { before: service.worktreeBeforeRevert, after: service.worktreeAfterRevert },
  },
  {
    name: "service/restore",
    fn: "Snapshot.restore",
    input: `${scenario}; then change a.txt, delete moved/b.txt, add restore-extra.txt, restore the after snapshot`,
    output: service.worktreeAfterRestoreToAfter,
  },
  {
    name: "service/revert-validation",
    fn: "Snapshot.revert",
    input: "unknown hash with files; unknown hash without files",
    output: { unavailable: service.revertUnavailable, emptyFiles: service.revertEmptyFilesSkipsValidation },
  },
  {
    name: "service/repository-layout",
    fn: "Snapshot.track (seed, materialize)",
    input: scenario,
    output: service.layout,
  },
  {
    name: "service/retention-cleanup",
    fn: "Snapshot.cleanup",
    input: "snapshot pins at epoch+1ms, now-7d-1min, now-7d+1min, plus the pins of the scenario",
    output: service.refsAfterCleanup,
  },
  { name: "service/hashes", fn: "Snapshot.track", input: scenario, output: service.hashes },
]

await write({
  sources: [
    "packages/opencode/src/snapshot/index.ts",
    `${KILO_SNAPSHOT}/{seed,materialize,prepare,lock,cleanup,diff-full}.ts`,
    "packages/core/src/util/effect-flock.ts",
  ],
  constants: {
    ...out.pure.constants,
    note: "Seed log fields are parsed from the v1 snapshot.seed log line and are informational. Git object ids in patches read <oids>. The service cases share one scenario and ran in order.",
  },
  cases,
})
process.exit(0)
