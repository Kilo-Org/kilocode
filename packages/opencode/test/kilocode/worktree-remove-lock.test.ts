import { $ } from "bun"
import { describe, expect } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { Worktree } from "../../src/worktree"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Worktree.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("Worktree.remove lock retries", () => {
  it.live("retries transient git remove lock failures", () =>
    provideTmpdirInstance(
      (root) =>
        Effect.gen(function* () {
          const svc = yield* Worktree.Service
          const name = `remove-retry-${Date.now().toString(36)}`
          const branch = `opencode/${name}`
          const dir = path.join(root, "..", name)

          yield* Effect.promise(() => $`git worktree add --no-checkout -b ${branch} ${dir}`.cwd(root).quiet())
          yield* Effect.promise(() => $`git reset --hard`.cwd(dir).quiet())

          const real = (yield* Effect.promise(() => $`which git`.quiet().text())).trim()
          expect(real).toBeTruthy()

          const bin = path.join(root, "bin")
          const shim = path.join(bin, "git")
          const state = path.join(bin, "attempt")
          yield* Effect.promise(() => fs.mkdir(bin, { recursive: true }))
          yield* Effect.promise(() =>
            Bun.write(
              shim,
              [
                "#!/bin/bash",
                `REAL_GIT=${JSON.stringify(real)}`,
                `STATE=${JSON.stringify(state)}`,
                'if [ "$1" = "worktree" ] && [ "$2" = "remove" ] && [ ! -f "$STATE" ]; then',
                '  touch "$STATE"',
                '  echo "fatal: EBUSY: resource busy or locked, rmdir $4" >&2',
                "  exit 1",
                "fi",
                'exec "$REAL_GIT" "$@"',
              ].join("\n"),
            ),
          )
          yield* Effect.promise(() => fs.chmod(shim, 0o755))

          const prev = yield* Effect.acquireRelease(
            Effect.sync(() => {
              const prev = process.env.PATH ?? ""
              process.env.PATH = `${bin}${path.delimiter}${prev}`
              return prev
            }),
            (prev) =>
              Effect.sync(() => {
                process.env.PATH = prev
              }),
          )
          void prev

          const ok = yield* svc.remove({ directory: dir })

          expect(ok).toBe(true)
          expect(
            yield* Effect.promise(() =>
              fs
                .stat(dir)
                .then(() => true)
                .catch(() => false),
            ),
          ).toBe(false)

          const list = yield* Effect.promise(() => $`git worktree list --porcelain`.cwd(root).quiet().text())
          expect(list).not.toContain(`worktree ${dir}`)
        }),
      { git: true },
    ),
  )
})
