import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { assertWrite, run as runSandbox } from "@kilocode/sandbox"
import { Effect, Exit } from "effect"
import { profile } from "@/kilocode/sandbox/policy"
import { SandboxPreference } from "@/kilocode/sandbox/preference"
import { SandboxStore } from "@/kilocode/sandbox/store"
import { Wakeup } from "@/kilocode/wakeup"
import type { InstanceContext } from "@/project/instance-context"
import { SessionID } from "@/session/schema"
import { ProjectV2 } from "@opencode-ai/core/project"
import { tmpdir } from "../../fixture/fixture"

const kilo = [
  Global.Path.data,
  Global.Path.cache,
  Global.Path.config,
  Global.Path.state,
  Global.Path.tmp,
  Global.Path.bin,
  Global.Path.log,
  Global.Path.repos,
]

type Dirs = {
  main: string
  local: string
  separate: string
  separateLocal: string
  a: string
  b: string
  external: string
  approved: string
}

function fixture() {
  return tmpdir<Dirs>({
    init: async (root) => {
      const main = path.join(root, "main")
      const local = path.join(main, "packages", "app")
      const separate = path.join(root, "separate")
      const separateLocal = path.join(separate, "packages", "app")
      const store = path.join(root, "separate-git")
      const a = path.join(main, ".kilo", "worktrees", "a")
      const b = path.join(main, ".kilo", "worktrees", "b")
      const external = path.join(root, "imported")
      const approved = path.join(root, "approved")
      await Promise.all([
        fs.mkdir(path.join(main, ".git"), { recursive: true }),
        fs.mkdir(local, { recursive: true }),
        fs.mkdir(separateLocal, { recursive: true }),
        fs.mkdir(store, { recursive: true }),
        fs.mkdir(a, { recursive: true }),
        fs.mkdir(b, { recursive: true }),
        fs.mkdir(external, { recursive: true }),
        fs.mkdir(approved, { recursive: true }),
      ])
      await fs.writeFile(path.join(separate, ".git"), `gitdir: ${store}\n`)
      await Promise.all(
        [a, b, external].map(async (dir, index) => {
          const git = path.join(root, "worktrees", String(index))
          await fs.mkdir(git, { recursive: true })
          await fs.writeFile(path.join(git, "commondir"), "../..\n")
          await fs.writeFile(path.join(dir, ".git"), `gitdir: ${git}\n`)
        }),
      )
      return { main, local, separate, separateLocal, a, b, external, approved }
    },
  })
}

function context(directory: string, worktree: string, dirs: Dirs): InstanceContext {
  return {
    directory,
    worktree,
    project: {
      id: ProjectV2.ID.make("sandbox-policy-test"),
      worktree: dirs.main,
      vcs: "git",
      time: { created: 0, updated: 0 },
      sandboxes: [dirs.a, dirs.b, dirs.external],
    },
  }
}

function roots(ctx: InstanceContext) {
  return profile(ctx).filesystem.allowWrite.map((rule) => rule.path)
}

function expected(...directories: string[]) {
  return new Set([...directories, ...kilo])
}

const posix = process.platform === "win32" ? test.skip : test

describe("sandbox policy", () => {
  test("keeps a normal checkout writable from an active subdirectory", async () => {
    await using tmp = await fixture()
    const dirs = tmp.extra
    const ctx = context(dirs.local, dirs.main, dirs)
    const result = roots(ctx)
    const write = await Effect.runPromise(
      runSandbox(profile(ctx), assertWrite(path.join(dirs.main, "outside-cwd.txt")).pipe(Effect.exit)),
    )

    expect(new Set(result)).toEqual(expected(dirs.main, dirs.local))
    expect(result).not.toContain(dirs.a)
    expect(result).not.toContain(dirs.b)
    expect(Exit.isSuccess(write)).toBe(true)
  })

  test("keeps a separate git directory checkout writable from an active subdirectory", async () => {
    await using tmp = await fixture()
    const dirs = tmp.extra
    const ctx = context(dirs.separateLocal, dirs.separate, dirs)
    const result = roots(ctx)

    expect(new Set(result)).toEqual(expected(dirs.separate, dirs.separateLocal))
  })

  test("confines a managed worktree to its active directory", async () => {
    await using tmp = await fixture()
    const dirs = tmp.extra
    const actual = roots(context(dirs.a, dirs.a, dirs))
    const shared = roots(context(dirs.a, dirs.main, dirs))

    expect(new Set(actual)).toEqual(expected(dirs.a))
    expect(new Set(shared)).toEqual(expected(dirs.a))
    expect(actual).not.toContain(dirs.main)
    expect(actual).not.toContain(dirs.b)
  })

  test("drops inherited writable ancestors for a managed worktree", async () => {
    await using tmp = await fixture()
    const dirs = tmp.extra
    const policy = profile(context(dirs.a, dirs.main, dirs), "deny", [dirs.main, dirs.approved])
    const paths = policy.filesystem.allowWrite.map((rule) => rule.path)

    expect(paths).not.toContain(dirs.main)
    expect(paths).toContain(dirs.approved)
    expect(paths).toContain(dirs.a)
  })

  posix("fails closed when a worktree marker cannot be resolved", async () => {
    await using tmp = await fixture()
    const dirs = tmp.extra
    await fs.symlink(".git", path.join(dirs.local, ".git"))
    const result = roots(context(dirs.local, dirs.main, dirs))

    expect(new Set(result)).toEqual(expected(dirs.local))
    expect(result).not.toContain(dirs.main)
  })

  test("confines an imported worktree to its active directory", async () => {
    await using tmp = await fixture()
    const dirs = tmp.extra
    const result = roots(context(dirs.external, dirs.external, dirs))

    expect(new Set(result)).toEqual(expected(dirs.external))
    expect(result).not.toContain(dirs.main)
    expect(result).not.toContain(dirs.a)
    expect(result).not.toContain(dirs.b)
  })

  test("derives concurrent worktree profiles without cross-contamination", async () => {
    await using tmp = await fixture()
    const dirs = tmp.extra
    const check = (own: InstanceContext, other: string) =>
      runSandbox(
        profile(own),
        Effect.all({
          own: assertWrite(path.join(own.directory, "allowed.txt")).pipe(Effect.exit),
          other: assertWrite(path.join(other, "denied.txt")).pipe(Effect.exit),
        }),
      )
    const [left, right] = await Effect.runPromise(
      Effect.all([check(context(dirs.a, dirs.a, dirs), dirs.b), check(context(dirs.b, dirs.b, dirs), dirs.a)], {
        concurrency: "unbounded",
      }),
    )

    expect(Exit.isSuccess(left.own)).toBe(true)
    expect(Exit.isFailure(left.other)).toBe(true)
    expect(Exit.isSuccess(right.own)).toBe(true)
    expect(Exit.isFailure(right.other)).toBe(true)
  })

  test("keeps Kilo state writable without exposing sandbox policy state", async () => {
    await using tmp = await fixture()
    const dirs = tmp.extra
    const ctx = context(dirs.a, dirs.a, dirs)
    const policy = profile(ctx)
    const [storeWrite, prefWrite, claudeWrite] = await Effect.runPromise(
      Effect.all([
        runSandbox(policy, assertWrite(SandboxStore.root)).pipe(Effect.exit),
        runSandbox(policy, assertWrite(SandboxPreference.root)).pipe(Effect.exit),
        runSandbox(policy, assertWrite(path.join(Global.Path.home, ".claude", "settings.json"))).pipe(Effect.exit),
      ]),
    )

    expect(new Set(roots(ctx))).toEqual(expected(dirs.a))
    expect(policy.filesystem.temporaryDirectory).toBe(Global.Path.tmp)
    expect(policy.filesystem.denyWrite.slice(0, 6)).toEqual([
      { path: SandboxStore.root, kind: "subtree" },
      { path: SandboxPreference.root, kind: "subtree" },
      { path: Global.Path.config, kind: "subtree" },
      { path: path.join(Global.Path.home, ".kilo"), kind: "subtree" },
      { path: path.join(Global.Path.home, ".kilocode"), kind: "subtree" },
      { path: path.join(Global.Path.home, ".claude"), kind: "subtree" },
    ])
    expect(policy.environment.deny).toEqual([
      "KILO_CONFIG",
      "KILO_CONFIG_CONTENT",
      "KILO_CONFIG_DIR",
      "KILO_SERVER_PASSWORD",
      "KILO_SERVER_USERNAME",
      "KILO_BROWSER_BROKER_URL",
      "KILO_BROWSER_BROKER_TOKEN",
    ])
    expect(Exit.isFailure(storeWrite)).toBe(true)
    expect(Exit.isFailure(prefWrite)).toBe(true)
    expect(Exit.isFailure(claudeWrite)).toBe(true)
  })

  test("keeps a KILO_CONFIG_DIR override read-only", async () => {
    await using tmp = await fixture()
    const dirs = tmp.extra
    const dir = path.join(dirs.a, "config")
    const previous = process.env.KILO_CONFIG_DIR
    process.env.KILO_CONFIG_DIR = dir
    try {
      const policy = profile(context(dirs.a, dirs.a, dirs))
      expect(policy.filesystem.denyWrite).toContainEqual({ path: dir, kind: "subtree" })
      const write = await Effect.runPromise(
        runSandbox(policy, assertWrite(path.join(dir, "kilo.jsonc"))).pipe(Effect.exit),
      )
      expect(Exit.isFailure(write)).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.KILO_CONFIG_DIR
      else process.env.KILO_CONFIG_DIR = previous
    }
  })

  test("uses deny-by-default and configurable network profiles", async () => {
    await using tmp = await fixture()
    const dirs = tmp.extra
    const ctx = context(dirs.a, dirs.a, dirs)

    expect(profile(ctx).network).toEqual({ mode: "deny", allowedHosts: [] })
    expect(profile(ctx, "allow").network).toEqual({ mode: "allow", allowedHosts: [] })
  })

  test("keeps .git denied inside overlapping writable roots", async () => {
    await using tmp = await fixture()
    const dirs = tmp.extra
    const linked = context(dirs.a, dirs.a, dirs)
    const local = context(dirs.local, dirs.main, dirs)
    const result = await Effect.runPromise(
      Effect.all([
        runSandbox(profile(linked), assertWrite(path.join(dirs.a, ".git")).pipe(Effect.exit)),
        runSandbox(profile(linked), assertWrite(path.join(dirs.a, "nested", ".git", "config")).pipe(Effect.exit)),
        runSandbox(profile(local), assertWrite(path.join(dirs.main, ".git", "config")).pipe(Effect.exit)),
      ]),
    )

    expect(result.every(Exit.isFailure)).toBe(true)
    expect(profile(linked).filesystem.denyNames).toContain(".git")
  })

  test("does not add externally approved paths to writable roots", async () => {
    await using tmp = await fixture()
    const dirs = tmp.extra
    const ctx = context(dirs.a, dirs.a, dirs)
    const result = await Effect.runPromise(
      runSandbox(profile(ctx), assertWrite(path.join(dirs.approved, "denied.txt")).pipe(Effect.exit)),
    )

    expect(roots(ctx)).not.toContain(dirs.approved)
    expect(Exit.isFailure(result)).toBe(true)
  })

  test("makes configured extra writable paths writable while unlisted paths stay denied", async () => {
    await using tmp = await fixture()
    const dirs = tmp.extra
    const ctx = context(dirs.a, dirs.a, dirs)
    const policy = profile(ctx, "deny", [dirs.approved])
    const result = await Effect.runPromise(
      Effect.all({
        extra: runSandbox(policy, assertWrite(path.join(dirs.approved, "allowed.txt")).pipe(Effect.exit)),
        other: runSandbox(policy, assertWrite(path.join(dirs.b, "denied.txt")).pipe(Effect.exit)),
      }),
    )

    expect(policy.filesystem.allowWrite.map((rule) => rule.path)).toContain(dirs.approved)
    expect(roots(ctx)).not.toContain(dirs.approved)
    expect(Exit.isSuccess(result.extra)).toBe(true)
    expect(Exit.isFailure(result.other)).toBe(true)
  })

  test("keeps .git denied inside a configured extra writable path", async () => {
    await using tmp = await fixture()
    const dirs = tmp.extra
    const ctx = context(dirs.a, dirs.a, dirs)
    const policy = profile(ctx, "deny", [dirs.approved])
    const result = await Effect.runPromise(
      runSandbox(policy, assertWrite(path.join(dirs.approved, ".git", "config")).pipe(Effect.exit)),
    )

    expect(Exit.isFailure(result)).toBe(true)
  })

  describe("content Kilo runs or acts on outside the sandbox", () => {
    const SCRIPTS = ["setup-script", "run-script"].flatMap((name) =>
      ["", ".sh", ".ps1", ".cmd", ".bat"].map((ext) => name + ext),
    )
    const scripts = (dir: string) =>
      [".kilo", ".kilocode"].flatMap((sub) =>
        SCRIPTS.map((name) => ({ path: path.join(dir, sub, name), kind: "literal" as const })),
      )
    const queues = ["wakeup", "cron"].map((key) => ({
      path: path.join(Global.Path.data, "storage", key),
      kind: "subtree" as const,
    }))

    async function database<T>(file: string, fn: () => Promise<T>) {
      const previous = Flag.KILO_DB
      Flag.KILO_DB = file
      try {
        return await fn()
      } finally {
        Flag.KILO_DB = previous
      }
    }

    test("denies the worktree scripts of every project root once, the database files and the queues", async () => {
      await using tmp = await fixture()
      const dirs = tmp.extra
      const db = path.join(tmp.path, "kilo.db")
      await database(db, async () => {
        const single = profile(context(dirs.main, dirs.main, dirs)).filesystem.denyWrite
        const nested = profile(context(dirs.local, dirs.main, dirs)).filesystem.denyWrite
        const named = (rules: typeof single) => rules.filter((rule) => /(setup|run)-script/.test(rule.path))

        expect(named(single)).toEqual(scripts(dirs.main))
        expect(named(single)).toHaveLength(20)
        expect(named(nested)).toEqual([...scripts(dirs.main), ...scripts(dirs.local)])
        expect(single).toEqual(
          expect.arrayContaining([
            ...[db, `${db}-wal`, `${db}-shm`, `${db}-journal`].map((file) => ({
              path: file,
              kind: "literal" as const,
            })),
            ...queues,
          ]),
        )
        // Bubblewrap only protects deny paths that exist, so the queues are created up front.
        for (const queue of queues) expect((await fs.stat(queue.path)).isDirectory()).toBe(true)
      })
    })

    test("refuses sandboxed writes to setup and run scripts, the database and the queues, not to other .kilo files", async () => {
      await using tmp = await fixture()
      const dirs = tmp.extra
      const db = path.join(tmp.path, "kilo.db")
      await database(db, async () => {
        const policy = profile(context(dirs.main, dirs.main, dirs))
        const write = (target: string) => Effect.runPromise(runSandbox(policy, assertWrite(target)).pipe(Effect.exit))
        for (const target of [
          path.join(dirs.main, ".kilo", "setup-script"),
          path.join(dirs.main, ".kilo", "run-script.ps1"),
          path.join(dirs.main, ".kilocode", "setup-script.sh"),
          db,
          `${db}-wal`,
          path.join(Global.Path.data, "storage", "wakeup", "ses_x", "wku_forged.json"),
          path.join(Global.Path.data, "storage", "cron", "ses_x", "wku_forged.json"),
        ])
          expect(Exit.isFailure(await write(target))).toBe(true)
        expect(Exit.isSuccess(await write(path.join(dirs.main, ".kilo", "plans", "plan.md")))).toBe(true)
        expect(Exit.isSuccess(await write(path.join(Global.Path.data, "storage", "session", "x.json")))).toBe(true)
      })
    })

    test("the Wakeup service still writes its queue for a sandboxed tool while direct writes are refused", async () => {
      await using tmp = await fixture()
      const dirs = tmp.extra
      const policy = profile(context(dirs.main, dirs.main, dirs))
      const sessionID = SessionID.make(`ses_sandbox_wakeup_${Date.now()}`)
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const wake = yield* Wakeup.Service
          const files = yield* FSUtil.Service
          const info = yield* runSandbox(
            policy,
            wake.schedule({
              sessionID,
              directory: dirs.main,
              prompt: "check the deploy",
              when: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            }),
          )
          const listed = yield* wake.list({ sessionID })
          const forged = yield* runSandbox(
            policy,
            files.writeWithDirs(
              path.join(Global.Path.data, "storage", "wakeup", sessionID, "wku_forged.json"),
              JSON.stringify({ ...info, id: "wku_forged" }),
            ),
          ).pipe(Effect.exit)
          const cancelled = yield* runSandbox(policy, wake.cancel(info.id, sessionID))
          return { info, listed, forged, cancelled, left: yield* wake.list({ sessionID }) }
        }).pipe(Effect.scoped, Effect.provide(AppNodeBuilder.build(LayerNode.group([Wakeup.node, FSUtil.node])))),
      )
      expect(result.listed.map((item) => item.id)).toEqual([result.info.id])
      expect(Exit.isFailure(result.forged)).toBe(true)
      expect(result.cancelled?.id).toBe(result.info.id)
      expect(result.left).toEqual([])
    })
  })
})
