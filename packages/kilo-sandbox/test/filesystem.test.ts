import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Scope, Stream } from "effect"
import { run } from "../src/context"
import { layer } from "../src/filesystem"
import { batchMutations, currentRunner, withRunner, type Runner } from "../src/mutation"
import type { Request } from "../src/mutation-protocol"
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

  test.skipIf(process.platform !== "darwin")(
    "guards writes with PermissionDenied and forwards mutation options through Seatbelt",
    async () => {
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
    },
  )

  test("batches nested finite mutations in request order", async () => {
    await mkdir(allowed, { recursive: true })
    const requests: Request[] = []
    const runner: Runner = (_profile, request) => Effect.sync(() => requests.push(request)).pipe(Effect.as(undefined))
    await execute(
      withRunner(
        runner,
        run(
          makeProfile(allowed),
          batchMutations(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem
              yield* fs.makeDirectory(path.join(allowed, "nested"), { recursive: true })
              yield* batchMutations(fs.writeFileString(path.join(allowed, "nested", "value.txt"), "value"))
              yield* fs.chmod(path.join(allowed, "nested", "value.txt"), 0o600)
            }),
          ),
        ),
      ),
    )
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      op: "batch",
      operations: [{ op: "makeDirectory" }, { op: "writeFileString" }, { op: "chmod" }],
    })
  })

  test("flushes queued mutations before propagating a later failure", async () => {
    await mkdir(allowed, { recursive: true })
    const requests: Request[] = []
    const runner: Runner = (_profile, request) => Effect.sync(() => requests.push(request)).pipe(Effect.as(undefined))
    const exit = await execute(
      withRunner(
        runner,
        run(
          makeProfile(allowed),
          batchMutations(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem
              yield* fs.writeFileString(path.join(allowed, "value.txt"), "value")
              return yield* Effect.fail("later failure")
            }),
          ),
        ),
      ).pipe(Effect.exit),
    )
    expect(exit._tag).toBe("Failure")
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ op: "batch", operations: [{ op: "writeFileString" }] })
  })

  test("delegates runners retained after a batch closes", async () => {
    const requests: Request[] = []
    const runner: Runner = (_profile, request) => Effect.sync(() => requests.push(request)).pipe(Effect.as(undefined))
    const escaped = await execute(withRunner(runner, batchMutations(currentRunner)))
    await execute(escaped(makeProfile(allowed), { op: "remove", path: path.join(allowed, "value.txt") }))
    expect(requests).toEqual([{ op: "remove", path: path.join(allowed, "value.txt") }])
  })

  test("delegates retained runners while the final batch flush is in flight", async () => {
    const requests: Request[] = []
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const profile = makeProfile(allowed)
    const queued: Request = { op: "remove", path: path.join(allowed, "queued.txt") }
    const late: Request = { op: "remove", path: path.join(allowed, "late.txt") }
    const runner: Runner = (_profile, request) =>
      Effect.promise(() => {
        requests.push(request)
        if (requests.length === 1) {
          started.resolve()
          return release.promise.then(() => undefined)
        }
        return Promise.resolve(undefined)
      })
    let escaped: Runner | undefined
    const closing = execute(
      withRunner(
        runner,
        batchMutations(
          Effect.gen(function* () {
            escaped = yield* currentRunner
            yield* escaped(profile, queued)
          }),
        ),
      ),
    )

    await started.promise
    if (!escaped) throw new Error("Mutation runner did not escape")
    try {
      await execute(escaped(profile, late))
      expect(requests).toEqual([{ op: "batch", operations: [queued] }, late])
    } finally {
      release.resolve()
      await closing
    }
  })

  test("allows read-only open but guards writable open and sink", async () => {
    const inside = path.join(allowed, "open.txt")
    await mkdir(allowed, { recursive: true })
    await writeFile(inside, "inside")
    await execute(
      run(
        makeProfile(allowed),
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          yield* fs.open(outside, { flag: "r" })
          const open = yield* fs.open(outside, { flag: "r+" }).pipe(Effect.flip)
          expect(open.reason._tag).toBe("PermissionDenied")
          const restricted = yield* fs.open(inside, { flag: "r+" }).pipe(Effect.flip)
          expect(restricted.reason._tag).toBe("PermissionDenied")
          expect(restricted.reason.description).toContain("Writable file handles")
          const sink = yield* Stream.run(Stream.make(new TextEncoder().encode("blocked")), fs.sink(outside)).pipe(
            Effect.flip,
          )
          expect(sink.reason._tag).toBe("PermissionDenied")
        }),
      ),
    )
  })

  test.skipIf(process.platform !== "darwin")(
    "redirects default temporary files and directories and preserves their options",
    async () => {
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
    },
  )

  test.skipIf(process.platform !== "darwin")(
    "preserves finite mutation data, options, timestamps, and links",
    async () => {
      const base = path.join(allowed, "operations")
      const source = path.join(base, "source.bin")
      const copy = path.join(base, "copy.bin")
      const tree = path.join(base, "tree")
      const copied = path.join(base, "copied")
      const hard = path.join(base, "hard.bin")
      const symbolic = path.join(base, "symbolic.bin")
      const streamed = path.join(base, "streamed.bin")
      const time = new Date("2024-01-02T03:04:05.000Z")
      const copiedTime = new Date("2023-02-03T04:05:06.000Z")
      await execute(
        run(
          makeProfile(allowed),
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem
            yield* fs.makeDirectory(tree, { recursive: true, mode: 0o700 })
            yield* fs.writeFile(source, Uint8Array.from([0, 255, 1, 254]), { flag: "wx", mode: 0o600 })
            yield* fs.chmod(source, 0o640)
            yield* fs.chown(source, process.getuid!(), process.getgid!())
            yield* fs.truncate(source, 3)
            yield* fs.utimes(source, time, time)
            yield* fs.copyFile(source, copy)
            const value = path.join(tree, "value.txt")
            yield* fs.writeFileString(value, "tree")
            yield* fs.utimes(value, copiedTime, copiedTime)
            yield* fs.copy(tree, copied, { overwrite: true, preserveTimestamps: true })
            yield* fs.link(source, hard)
            yield* fs.symlink("source.bin", symbolic)
            yield* Stream.run(
              Stream.make(Uint8Array.from([1, 2]), Uint8Array.from([3, 4])),
              fs.sink(streamed, { flag: "wx", mode: 0o600 }),
            )
          }),
        ),
      )
      expect([...(await readFile(source))]).toEqual([0, 255, 1])
      expect([...(await readFile(copy))]).toEqual([0, 255, 1])
      expect([...(await readFile(hard))]).toEqual([0, 255, 1])
      expect([...(await readFile(symbolic))]).toEqual([0, 255, 1])
      expect([...(await readFile(streamed))]).toEqual([1, 2, 3, 4])
      expect(await readFile(path.join(copied, "value.txt"), "utf8")).toBe("tree")
      const info = await stat(source)
      const copiedInfo = await stat(path.join(copied, "value.txt"))
      expect(info.mode & 0o777).toBe(0o640)
      expect(info.mtime.getTime()).toBe(time.getTime())
      expect(copiedInfo.mtime.getTime()).toBe(copiedTime.getTime())
    },
  )

  test.skipIf(process.platform !== "darwin")(
    "cleans up scoped temporary files and directories through Seatbelt",
    async () => {
      const created: string[] = []
      await execute(
        run(
          makeProfile(allowed, allowed),
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem
            created.push(yield* fs.makeTempDirectoryScoped({ prefix: "scoped-directory-" }))
            created.push(yield* fs.makeTempFileScoped({ prefix: "scoped-file-", suffix: ".txt" }))
          }),
        ),
      )
      for (const item of created) {
        expect(
          await lstat(item).then(
            () => true,
            () => false,
          ),
        ).toBe(false)
      }
    },
  )

  test.skipIf(process.platform !== "darwin")(
    "removes and renames allowed symlink entries without following their targets",
    async () => {
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
    },
  )

  test.skipIf(process.platform === "darwin" || process.platform === "linux")(
    "fails closed when the OS backend is unavailable",
    async () => {
      await execute(
        run(
          makeProfile(allowed),
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem
            const denied = yield* fs.writeFileString(path.join(allowed, "blocked.txt"), "blocked").pipe(Effect.flip)
            expect(denied.reason._tag).toBe("PermissionDenied")
          }),
        ),
      )
    },
  )

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
