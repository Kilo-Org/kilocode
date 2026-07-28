import { describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Git } from "../../../src/git"
import { CloudRepository } from "../../../src/kilocode/cloud/repository"
import { tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.mergeAll(Git.defaultLayer, CrossSpawnSpawner.defaultLayer))

const run = Effect.fn("CloudRepositoryTest.git")(function* (cwd: string, ...args: string[]) {
  const git = yield* Git.Service
  const result = yield* git.run(args, { cwd })
  if (result.exitCode === 0) return result.text().trim()
  return yield* Effect.die(new Error(result.stderr.toString("utf8")))
})

describe("CloudRepository", () => {
  it.live("resolves and validates an explicit repository branch outside Git", () =>
    Effect.gen(function* () {
      const cwd = yield* tmpdirScoped()
      const result = yield* CloudRepository.resolve({
        cwd,
        repo: "kilo-org/kilo",
        branch: "feature/cloud-start",
      })

      expect(result).toEqual({
        type: "github",
        repo: "kilo-org/kilo",
        branch: "feature/cloud-start",
      })

      const error = yield* CloudRepository.resolve({ cwd, repo: "kilo-org/kilo", branch: "feature.lock" }).pipe(
        Effect.flip,
      )
      expect(error).toBeInstanceOf(CloudRepository.InvalidBranchError)

      const type = yield* CloudRepository.resolve({
        cwd,
        repo: "https://github.com/kilo-org/kilo.git",
        type: "gitlab",
      }).pipe(Effect.flip)
      expect(type).toBeInstanceOf(CloudRepository.InvalidRepositoryError)
    }),
  )

  it.live("rejects GitHub repositories that become dot segments after trimming .git", () =>
    Effect.gen(function* () {
      const cwd = yield* tmpdirScoped()

      for (const repo of ["https://github.com/kilo-org/...git", "git@github.com:kilo-org/...git"]) {
        const error = yield* CloudRepository.resolve({ cwd, repo }).pipe(Effect.flip)
        expect(error).toBeInstanceOf(CloudRepository.InvalidRepositoryError)
      }
    }),
  )

  it.live("normalizes an inferred GitHub SCP remote without adding the current branch", () =>
    Effect.gen(function* () {
      const cwd = yield* tmpdirScoped({ git: true })
      yield* run(cwd, "remote", "add", "origin", "git@github.com:kilo-org/ssh-repo.git")
      yield* run(cwd, "checkout", "-b", "feature/not-in-output")

      const result = yield* CloudRepository.resolve({ cwd })

      expect(result).toEqual({ type: "github", repo: "kilo-org/ssh-repo" })
    }),
  )

  it.live("rejects inferred local remotes that resemble GitHub shorthand", () =>
    Effect.gen(function* () {
      const cwd = yield* tmpdirScoped({ git: true })
      yield* run(cwd, "remote", "add", "origin", "kilo-org/local-repo")

      const error = yield* CloudRepository.resolve({ cwd }).pipe(Effect.flip)

      expect(error).toBeInstanceOf(CloudRepository.InvalidRepositoryError)
    }),
  )

  it.live("prefers the tracking remote, then origin, then a sole remote fetch URL", () =>
    Effect.gen(function* () {
      const cwd = yield* tmpdirScoped({ git: true })
      const git = yield* Git.Service
      const branch = yield* git.branch(cwd)
      if (!branch) yield* Effect.die(new Error("temporary repository has no current branch"))

      yield* run(cwd, "remote", "add", "origin", "https://github.com/kilo-org/origin.git")
      yield* run(cwd, "remote", "add", "tracked", "https://github.com/kilo-org/tracked.git")
      yield* run(cwd, "remote", "set-url", "--add", "--push", "tracked", "https://github.com/kilo-org/push.git")
      yield* run(cwd, "config", `branch.${branch}.remote`, "tracked")

      expect(yield* CloudRepository.resolve({ cwd })).toEqual({ type: "github", repo: "kilo-org/tracked" })

      yield* run(cwd, "config", `branch.${branch}.remote`, "missing")
      expect(yield* CloudRepository.resolve({ cwd })).toEqual({ type: "github", repo: "kilo-org/origin" })

      yield* run(cwd, "remote", "remove", "origin")
      expect(yield* CloudRepository.resolve({ cwd })).toEqual({ type: "github", repo: "kilo-org/tracked" })
    }),
  )

  it.live("returns typed errors when no remote can be selected", () =>
    Effect.gen(function* () {
      const cwd = yield* tmpdirScoped({ git: true })

      const none = yield* CloudRepository.resolve({ cwd }).pipe(Effect.flip)
      expect(none).toBeInstanceOf(CloudRepository.NoRemoteError)

      yield* run(cwd, "remote", "add", "alpha", "https://github.com/kilo-org/alpha.git")
      yield* run(cwd, "remote", "add", "beta", "https://github.com/kilo-org/beta.git")

      const ambiguous = yield* CloudRepository.resolve({ cwd }).pipe(Effect.flip)
      expect(ambiguous).toBeInstanceOf(CloudRepository.AmbiguousRemoteError)
    }),
  )

})
