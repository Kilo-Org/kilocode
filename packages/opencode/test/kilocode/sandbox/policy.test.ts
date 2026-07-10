import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { assertWrite, run as runSandbox } from "@kilocode/sandbox"
import { Effect, Exit } from "effect"
import { profile } from "@/kilocode/sandbox/policy"
import { SandboxPreference } from "@/kilocode/sandbox/preference"
import { SandboxStore } from "@/kilocode/sandbox/store"
import type { InstanceContext } from "@/project/instance-context"
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
    const [storeWrite, prefWrite] = await Effect.runPromise(
      Effect.all([
        runSandbox(policy, assertWrite(SandboxStore.root)).pipe(Effect.exit),
        runSandbox(policy, assertWrite(SandboxPreference.root)).pipe(Effect.exit),
      ]),
    )

    expect(new Set(roots(ctx))).toEqual(expected(dirs.a))
    expect(policy.filesystem.temporaryDirectory).toBe(Global.Path.tmp)
    expect(policy.filesystem.denyWrite).toEqual([
      { path: SandboxStore.root, kind: "subtree" },
      { path: SandboxPreference.root, kind: "subtree" },
    ])
    expect(policy.environment.deny).toEqual(["KILO_SERVER_PASSWORD", "KILO_SERVER_USERNAME"])
    expect(Exit.isFailure(storeWrite)).toBe(true)
    expect(Exit.isFailure(prefWrite)).toBe(true)
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
})
