// kilocode_change - new file
//
// Tests for the git-based diff generator that replaced the JS Myers path.

import { $ } from "bun"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { DiffFull } from "../../src/kilocode/snapshot/diff-full"
import { Filesystem, Log } from "../../src/util"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

Log.init({ print: false })

// Mirror the caller's git-wrapping in `snapshot/index.ts`: always disable
// quotepath so non-ASCII filenames come through unescaped.
const gitResult = (dir: string) => (args: string[]) =>
  Effect.promise(async () => {
    const p = Bun.spawn(["git", "-c", "core.quotepath=false", ...args], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [text, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
    const code = await p.exited
    return { code, text, stderr }
  })

const gitText = (dir: string) => (args: string[]) =>
  Effect.promise(async () => {
    const p = Bun.spawn(["git", "-c", "core.quotepath=false", ...args], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    })
    await p.exited
    return await new Response(p.stdout).text()
  })

const commit = async (dir: string, message: string) => {
  await $`git add -A`.cwd(dir).quiet()
  await $`git commit --no-gpg-sign -m ${message}`.cwd(dir).quiet()
  const head = await $`git rev-parse HEAD`.cwd(dir).quiet()
  return head.stdout.toString().trim()
}

const it = testEffect(Layer.mergeAll(CrossSpawnSpawner.defaultLayer))

describe("DiffFull.batch", () => {
  it.live("produces one patch per modified file", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(async () => {
        await Filesystem.write(path.join(dir, "a.txt"), "alpha\nbeta\ngamma\n")
        await Filesystem.write(path.join(dir, "b.txt"), "one\ntwo\nthree\n")
        await Filesystem.write(path.join(dir, "c.txt"), "red\nblue\ngreen\n")
      })
      const from = yield* Effect.promise(() => commit(dir, "v1"))
      yield* Effect.promise(async () => {
        await Filesystem.write(path.join(dir, "a.txt"), "alpha\nBETA\ngamma\n")
        await Filesystem.write(path.join(dir, "b.txt"), "one\nTWO\nthree\n")
        await Filesystem.write(path.join(dir, "c.txt"), "red\nBLUE\ngreen\n")
      })
      const to = yield* Effect.promise(() => commit(dir, "v2"))

      const result = yield* DiffFull.batch(gitResult(dir), from, to, ["a.txt", "b.txt", "c.txt"])
      expect(result.size).toBe(3)
      expect(result.get("a.txt")).toMatch(/^diff --git /)
      expect(result.get("a.txt")).toContain("-beta")
      expect(result.get("a.txt")).toContain("+BETA")
      expect(result.get("b.txt")).toContain("-two")
      expect(result.get("b.txt")).toContain("+TWO")
      expect(result.get("c.txt")).toContain("-blue")
      expect(result.get("c.txt")).toContain("+BLUE")
    }),
  )

  it.live("tolerates paths with spaces and unicode", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const names = ["my file.txt", "héllo.txt", "a b c.md"]
      yield* Effect.promise(async () => {
        for (const name of names) {
          await Filesystem.write(path.join(dir, name), "before\n")
        }
      })
      const from = yield* Effect.promise(() => commit(dir, "v1"))
      yield* Effect.promise(async () => {
        for (const name of names) {
          await Filesystem.write(path.join(dir, name), "after\n")
        }
      })
      const to = yield* Effect.promise(() => commit(dir, "v2"))

      const result = yield* DiffFull.batch(gitResult(dir), from, to, names)
      expect(result.size).toBe(names.length)
      for (const name of names) {
        const patch = result.get(name)
        expect(patch).toBeDefined()
        expect(patch).toContain("-before")
        expect(patch).toContain("+after")
      }
    }),
  )

  it.live("returns an empty map without spawning for an empty file list", () =>
    Effect.gen(function* () {
      let calls = 0
      const stub = (_: string[]) =>
        Effect.sync(() => {
          calls += 1
          return { code: 0, text: "", stderr: "" }
        })
      const result = yield* DiffFull.batch(stub, "from", "to", [])
      expect(result.size).toBe(0)
      expect(calls).toBe(0)
    }),
  )

  it.live("returns an empty map on git failure", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(async () => {
        await Filesystem.write(path.join(dir, "a.txt"), "hi\n")
      })
      yield* Effect.promise(() => commit(dir, "v1"))
      const result = yield* DiffFull.batch(gitResult(dir), "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "HEAD", [
        "a.txt",
      ])
      expect(result.size).toBe(0)
    }),
  )

  it.live(
    "chunks 1200 files across three spawns and returns all entries",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const names = Array.from({ length: 1200 }, (_, i) => `f${i.toString().padStart(4, "0")}.txt`)
        yield* Effect.promise(async () => {
          await Promise.all(names.map((name) => Filesystem.write(path.join(dir, name), "before\n")))
        })
        const from = yield* Effect.promise(() => commit(dir, "v1"))
        yield* Effect.promise(async () => {
          await Promise.all(names.map((name) => Filesystem.write(path.join(dir, name), "after\n")))
        })
        const to = yield* Effect.promise(() => commit(dir, "v2"))

        let calls = 0
        const counting = (cmd: string[]) => {
          calls += 1
          return gitResult(dir)(cmd)
        }
        const result = yield* DiffFull.batch(counting, from, to, names)
        expect(result.size).toBe(1200)
        expect(calls).toBe(3)
        expect(result.get("f0000.txt")).toContain("-before")
        expect(result.get("f1199.txt")).toContain("+after")
      }),
    30_000,
  )
})

describe("DiffFull.file", () => {
  it.live("returns a structured + unified diff for a modified working-tree file", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(async () => {
        await Filesystem.write(path.join(dir, "foo.txt"), "line1\nline2\nline3\n")
      })
      yield* Effect.promise(() => commit(dir, "v1"))
      yield* Effect.promise(async () => {
        await Filesystem.write(path.join(dir, "foo.txt"), "line1\nCHANGED\nline3\n")
      })

      const got = yield* DiffFull.file(gitText(dir), "foo.txt")
      expect(got).not.toBeNull()
      expect(got!.text).toMatch(/^diff --git /)
      expect(got!.text).toContain("-line2")
      expect(got!.text).toContain("+CHANGED")
      expect(got!.patch.oldFileName).toBe("foo.txt")
      expect(got!.patch.newFileName).toBe("foo.txt")
      expect(got!.patch.hunks.length).toBeGreaterThan(0)
    }),
  )

  it.live("returns null for an unmodified file", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      yield* Effect.promise(async () => {
        await Filesystem.write(path.join(dir, "foo.txt"), "unchanged\n")
      })
      yield* Effect.promise(() => commit(dir, "v1"))

      const got = yield* DiffFull.file(gitText(dir), "foo.txt")
      expect(got).toBeNull()
    }),
  )

  it.live(
    "handles a 15,000-line file in under 500 ms",
    () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const before = Array.from({ length: 15_000 }, (_, i) => `v1_line_${i}`).join("\n") + "\n"
        const after = Array.from({ length: 15_000 }, (_, i) => `v2_line_${i}`).join("\n") + "\n"
        yield* Effect.promise(async () => {
          await Filesystem.write(path.join(dir, "big.txt"), before)
        })
        yield* Effect.promise(() => commit(dir, "v1"))
        yield* Effect.promise(async () => {
          await Filesystem.write(path.join(dir, "big.txt"), after)
        })

        const start = Date.now()
        const got = yield* DiffFull.file(gitText(dir), "big.txt")
        const elapsed = Date.now() - start
        expect(got).not.toBeNull()
        expect(got!.patch.hunks.length).toBeGreaterThan(0)
        expect(elapsed).toBeLessThan(500)
      }),
    10_000,
  )
})
