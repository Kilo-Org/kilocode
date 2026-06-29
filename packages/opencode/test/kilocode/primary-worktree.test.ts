import { $ } from "bun"
import { describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import path from "path"
import { Git } from "../../src/git"
import { primaryPaths, primaryWorktree } from "../../src/kilocode/primary-worktree"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Git.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("primaryWorktree", () => {
  it.live("returns the current checkout for a normal repository", () =>
    Effect.gen(function* () {
      const repo = yield* tmpdirScoped({ git: true })

      expect(yield* primaryWorktree(repo)).toBe(repo)
    }),
  )

  it.live("returns the primary checkout for a sibling linked worktree", () =>
    Effect.gen(function* () {
      const repo = yield* tmpdirScoped({ git: true })
      const worktree = path.join(path.dirname(repo), `${path.basename(repo)}-feature`)
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`git worktree remove --force ${worktree}`.cwd(repo).quiet().nothrow()).pipe(
          Effect.asVoid,
        ),
      )
      yield* Effect.promise(() => $`git worktree add -b primary-worktree-test ${worktree}`.cwd(repo).quiet())

      expect(yield* primaryWorktree(worktree)).toBe(repo)
    }),
  )

  it.live("maps nested ancestor paths into the primary checkout", () =>
    Effect.gen(function* () {
      const repo = yield* tmpdirScoped({ git: true })
      const worktree = path.join(path.dirname(repo), `${path.basename(repo)}-paths`)
      const dir = path.join(worktree, "packages", "app")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`git worktree remove --force ${worktree}`.cwd(repo).quiet().nothrow()).pipe(
          Effect.asVoid,
        ),
      )
      yield* Effect.promise(() => $`git worktree add -b primary-paths-test ${worktree}`.cwd(repo).quiet())
      yield* Effect.promise(() =>
        Promise.all([
          Bun.write(path.join(dir, "placeholder"), ""),
          Bun.write(path.join(repo, ".agents", "placeholder"), ""),
          Bun.write(path.join(repo, "packages", ".claude", "placeholder"), ""),
          Bun.write(path.join(repo, "packages", "app", ".agents", "placeholder"), ""),
        ]),
      )

      expect(yield* primaryPaths(dir, worktree, [".claude", ".agents"])).toEqual([
        path.join(repo, "packages", "app", ".agents"),
        path.join(repo, "packages", ".claude"),
        path.join(repo, ".agents"),
      ])
    }),
  )

  it.live("returns undefined outside a Git repository", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()

      expect(yield* primaryWorktree(dir)).toBeUndefined()
    }),
  )

  it.live("rechecks a path after it becomes a Git repository", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      expect(yield* primaryWorktree(dir)).toBeUndefined()

      yield* Effect.promise(() => $`git init ${dir}`.quiet())
      expect(yield* primaryWorktree(dir)).toBe(dir)
    }),
  )

  it.live("supports repository paths containing spaces", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const repo = path.join(dir, "repo with spaces")
      yield* Effect.promise(() => $`git init ${repo}`.quiet())

      expect(yield* primaryWorktree(repo)).toBe(repo)
    }),
  )

  it.live("supports primary checkout paths containing newlines", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const dir = yield* tmpdirScoped()
      const repo = path.join(dir, "primary-checkout\n")
      const worktree = path.join(dir, "feature")
      yield* Effect.promise(() => $`git init ${repo}`.quiet())
      yield* Effect.promise(() =>
        $`git -c user.name=Test -c user.email=test@example.com -c commit.gpgsign=false commit --allow-empty -m init`
          .cwd(repo)
          .quiet(),
      )
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`git worktree remove --force ${worktree}`.cwd(repo).quiet().nothrow()).pipe(
          Effect.asVoid,
        ),
      )
      yield* Effect.promise(() => $`git worktree add -b primary-newline-worktree ${worktree}`.cwd(repo).quiet())

      expect(yield* primaryWorktree(worktree)).toBe(repo)
    }),
  )

  it.live("returns a submodule checkout instead of its internal git directory", () =>
    Effect.gen(function* () {
      const parent = yield* tmpdirScoped({ git: true })
      const child = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(() => $`git -c protocol.file.allow=always submodule add ${child} sub`.cwd(parent).quiet())
      const submodule = path.join(parent, "sub")

      expect(yield* primaryWorktree(submodule)).toBe(submodule)
    }),
  )

  it.live("supports a separate Git directory", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const repo = path.join(dir, "checkout")
      const store = path.join(dir, "git-store")
      yield* Effect.promise(() => $`git init --separate-git-dir=${store} ${repo}`.quiet())

      expect(yield* primaryWorktree(repo)).toBe(repo)
    }),
  )

  it.live("returns undefined for a bare repository", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const repo = path.join(dir, "bare.git")
      yield* Effect.promise(() => $`git init --bare ${repo}`.quiet())

      expect(yield* primaryWorktree(repo)).toBeUndefined()
    }),
  )
})
