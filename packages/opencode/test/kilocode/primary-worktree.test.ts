import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { $ } from "bun"
import { describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { Git } from "../../src/git"
import { primaryPaths, primaryWorktree } from "../../src/kilocode/primary-worktree"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(Git.node), AppNodeBuilder.build(CrossSpawnSpawner.node)))

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
      // Resolving from inside the primary checkout itself must survive the newline too.
      expect(yield* primaryWorktree(repo)).toBe(repo)
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

  it.live("resolves the primary checkout with git older than 2.31", () =>
    Effect.gen(function* () {
      const repo = yield* tmpdirScoped({ git: true })
      const worktree = path.join(path.dirname(repo), `${path.basename(repo)}-legacy`)
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`git worktree remove --force ${worktree}`.cwd(repo).quiet().nothrow()).pipe(
          Effect.asVoid,
        ),
      )
      yield* Effect.promise(() => $`git worktree add -b primary-legacy-test ${worktree}`.cwd(repo).quiet())
      yield* Effect.promise(() => Bun.write(path.join(worktree, "packages", "app", "placeholder"), ""))
      yield* Effect.promise(() => Bun.write(path.join(repo, "packages", "app", "placeholder"), ""))
      const git = legacy(yield* Git.Service)

      for (const dir of [repo, path.join(repo, "packages", "app"), worktree, path.join(worktree, "packages", "app")]) {
        expect(yield* primaryWorktree(dir).pipe(Effect.provideService(Git.Service, git))).toBe(repo)
      }
    }),
  )

  it.live("does not guess a primary checkout path containing a newline without worktree list -z", () =>
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
      yield* Effect.promise(() => $`git worktree add -b legacy-newline-worktree ${worktree}`.cwd(repo).quiet())
      const git = legacy(yield* Git.Service)

      expect(yield* primaryWorktree(worktree).pipe(Effect.provideService(Git.Service, git))).toBeUndefined()
    }),
  )

  it.live("returns the checkout for a subdirectory reached through a symlinked parent", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const dir = yield* tmpdirScoped()
      const repo = path.join(dir, "real", "repo")
      const link = path.join(dir, "link")
      yield* Effect.promise(() => $`git init ${repo}`.quiet())
      yield* Effect.promise(() => Bun.write(path.join(repo, "packages", "app", "placeholder"), ""))
      yield* Effect.promise(() => fs.symlink(path.join(dir, "real"), link))

      expect(yield* primaryWorktree(path.join(link, "repo", "packages", "app"))).toBe(repo)
    }),
  )
})

// Forwards to real git but behaves like git 2.30, which prints an unknown rev-parse
// option back as an output line with exit code 0 and has no `worktree list -z`.
function legacy(git: Git.Interface) {
  const flag = "--path-format=absolute"
  return Git.Service.of({
    ...git,
    run: (args, opts) => {
      if (args[0] === "worktree" && args.includes("-z"))
        return Effect.succeed({
          exitCode: 129,
          text: () => "",
          stdout: Buffer.alloc(0),
          stderr: Buffer.from("error: unknown switch `z'\n"),
          truncated: false,
        })
      const at = args.indexOf(flag)
      if (args[0] !== "rev-parse" || at === -1) return git.run(args, opts)
      const rest = args.filter((arg) => arg !== flag)
      return git.run(rest, opts).pipe(
        Effect.map((result) => {
          if (result.exitCode !== 0) return result
          const lines = result.text().split("\n")
          const text = [...lines.slice(0, at - 1), flag, ...lines.slice(at - 1)].join("\n")
          return { ...result, text: () => text, stdout: Buffer.from(text) }
        }),
      )
    },
  })
}
