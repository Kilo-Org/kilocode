import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Scope, Stream } from "effect"
import { run } from "../src/context"
import { layer } from "../src/filesystem"
import type { Profile } from "../src/profile"

const live = layer.pipe(Layer.provide(NodeFileSystem.layer))

function makeProfile(root: string, temporaryDirectory?: string): Profile {
  return {
    filesystem: {
      allowWrite: [{ path: root, kind: "subtree" }],
      denyWrite: [],
      denyNames: [],
      ...(temporaryDirectory === undefined ? {} : { temporaryDirectory }),
    },
    network: { mode: "allow", allowedHosts: [] },
    environment: { deny: [], set: {} },
  }
}

function execute<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Scope.Scope>) {
  return Effect.runPromise(effect.pipe(Effect.provide(live), Effect.scoped))
}

describe("sandbox FileSystem", () => {
  let root = ""
  let allowed = ""
  let outside = ""

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "kilo-sandbox-filesystem-")))
    allowed = path.join(root, "allowed")
    outside = path.join(root, "outside.txt")
    await writeFile(outside, "outside")
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test("guards writes with PermissionDenied and forwards mutation options", async () => {
    await execute(
      run(
        makeProfile(allowed),
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const nested = path.join(allowed, "nested", "directory")
          yield* fs.makeDirectory(nested, { recursive: true, mode: 0o700 })
          const file = path.join(nested, "value.txt")
          yield* fs.writeFileString(file, "first", { flag: "wx", mode: 0o600 })
          const exists = yield* fs.writeFileString(file, "second", { flag: "wx" }).pipe(Effect.flip)
          expect(exists.reason._tag).toBe("AlreadyExists")
          const denied = yield* fs.writeFileString(outside, "blocked").pipe(Effect.flip)
          expect(denied.reason._tag).toBe("PermissionDenied")
        }),
      ),
    )
    expect(await readFile(path.join(allowed, "nested", "directory", "value.txt"), "utf8")).toBe("first")
    expect(await readFile(outside, "utf8")).toBe("outside")
  })

  test("allows read-only open but guards writable open and sink", async () => {
    await execute(
      run(
        makeProfile(allowed),
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          yield* fs.open(outside, { flag: "r" })
          const open = yield* fs.open(outside, { flag: "r+" }).pipe(Effect.flip)
          expect(open.reason._tag).toBe("PermissionDenied")
          const sink = yield* Stream.run(Stream.make(new TextEncoder().encode("blocked")), fs.sink(outside)).pipe(
            Effect.flip,
          )
          expect(sink.reason._tag).toBe("PermissionDenied")
        }),
      ),
    )
  })

  test("redirects default temporary files and directories and preserves their options", async () => {
    await execute(
      run(
        makeProfile(allowed, allowed),
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          yield* fs.makeDirectory(allowed, { recursive: true })
          const directory = yield* fs.makeTempDirectory({ prefix: "directory-" })
          const file = yield* fs.makeTempFile({ prefix: "file-", suffix: ".txt" })
          expect(path.dirname(directory)).toBe(allowed)
          expect(path.basename(directory).startsWith("directory-")).toBe(true)
          expect(path.dirname(path.dirname(file))).toBe(allowed)
          expect(path.basename(path.dirname(file)).startsWith("file-")).toBe(true)
          expect(file.endsWith(".txt")).toBe(true)
        }),
      ),
    )
  })

  test("removes and renames allowed symlink entries without following their targets", async () => {
    await mkdir(allowed, { recursive: true })
    const removed = path.join(allowed, "removed-link")
    const renamed = path.join(allowed, "renamed-link")
    const moved = path.join(allowed, "moved-link")
    await symlink(outside, removed)
    await symlink(outside, renamed)

    await execute(
      run(
        makeProfile(allowed),
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          yield* fs.remove(removed)
          yield* fs.rename(renamed, moved)
        }),
      ),
    )
    const missing = await lstat(removed).then(
      () => false,
      () => true,
    )
    expect(missing).toBe(true)
    expect((await lstat(moved)).isSymbolicLink()).toBe(true)
    expect(await readFile(outside, "utf8")).toBe("outside")
  })

  test("passes through mutations when no profile is active", async () => {
    await execute(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(outside, "passthrough")
      }),
    )
    expect(await readFile(outside, "utf8")).toBe("passthrough")
  })
})
