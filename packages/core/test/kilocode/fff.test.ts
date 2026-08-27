import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import { FileFinder, type InitOptions } from "@ff-labs/fff-bun"
import "@opencode-ai/core/filesystem"
import { Fff } from "@opencode-ai/core/filesystem/fff.bun"
import type { Interface as Search } from "@opencode-ai/core/filesystem/search"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Flag } from "@opencode-ai/core/flag/flag"
import { FSUtil } from "@opencode-ai/core/fs-util"
import fs from "node:fs/promises"
import path from "path"
import { Cause, Context, Effect, Layer, Scope } from "effect"
import { allowed } from "@opencode-ai/core/kilocode/fff"
import { Location } from "@opencode-ai/core/location"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"

async function search(fn: (service: Search, directory: string) => Promise<void>, opts: { alias?: boolean } = {}) {
  await using tmp = await tmpdir()
  const directory = opts.alias ? path.join(tmp.path, "link") : tmp.path
  if (opts.alias) {
    const target = path.join(tmp.path, "project")
    await fs.mkdir(target)
    await fs.symlink(target, directory, process.platform === "win32" ? "junction" : "dir")
  }
  const { FileSystemSearch } = await import("@opencode-ai/core/filesystem/search")
  const layer = FileSystemSearch.ripgrepLayer.pipe(
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(LayerNode.compile(Ripgrep.node)),
    Layer.provide(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
    ),
  )
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(layer)
        yield* Effect.promise(() => fn(Context.get(context, FileSystemSearch.Service), directory))
      }),
    ),
  )
}

describe("FFF scanning boundaries", () => {
  test("disables background indexing and watching by default while retaining explicit opt-in", async () => {
    const file = new URL("../../src/flag/flag.ts", import.meta.url).href
    const script = `import { Flag } from ${JSON.stringify(file)}; import { Effect } from "effect"; console.log(JSON.stringify({ fff: Flag.KILO_DISABLE_FFF, watcher: await Effect.runPromise(Effect.gen(function* () { return yield* Flag.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER })) }))`
    for (const value of [undefined, "false"]) {
      const child = Bun.spawn([process.execPath, "--eval", script], {
        cwd: path.resolve(import.meta.dir, "../.."),
        env: {
          ...process.env,
          KILO_DISABLE_FFF: value,
          KILO_EXPERIMENTAL_DISABLE_FILEWATCHER: value,
        },
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
      })
      const result = await new Response(child.stdout).json()
      expect(await child.exited).toBe(0)
      expect(result).toEqual({ fff: value === undefined, watcher: value === undefined })
    }
  })

  test("rejects POSIX, Windows drive, and UNC roots", () => {
    expect(allowed("/")).toBe(false)
    expect(allowed("C:\\")).toBe(false)
    expect(allowed("D:/")).toBe(false)
    expect(allowed("\\\\server\\share\\")).toBe(false)
    expect(allowed("\\\\?\\C:\\workspace\\..")).toBe(false)
    expect(allowed("\\\\?\\UNC\\server\\share\\")).toBe(false)
  })

  test("allows ordinary project directories", () => {
    expect(allowed("/workspace")).toBe(true)
    expect(allowed("C:\\workspace")).toBe(true)
    expect(allowed("D:/workspace")).toBe(true)
    expect(allowed("\\\\server\\share\\workspace")).toBe(true)
  })

  test("only searches safe project directories on request", async () => {
    const root = path.parse(process.cwd()).root
    await using tmp = await tmpdir()
    const link = path.join(tmp.path, "root")
    await fs.symlink(root, link, process.platform === "win32" ? "junction" : "dir")
    const create = FileFinder.create
    const disabled = Flag.KILO_DISABLE_FFF
    Flag.KILO_DISABLE_FFF = true
    const calls = { fff: 0, ripgrep: 0 }
    FileFinder.create = () => {
      calls.fff++
      return { ok: false, error: "FFF must not start at a filesystem root" }
    }
    const ripgrep = Layer.succeed(
      Ripgrep.Service,
      Ripgrep.Service.of({
        find: () => {
          calls.ripgrep++
          return Effect.succeed([])
        },
        glob: () => Effect.succeed({ items: [], truncated: false, partial: false }),
        grep: () => Effect.succeed({ items: [], truncated: false, partial: false }),
      }),
    )

    try {
      for (const directory of [root, link, tmp.path]) {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const { FileSystemSearch } = yield* Effect.promise(() => import("@opencode-ai/core/filesystem/search"))
              const layer = FileSystemSearch.locationLayer.pipe(
                Layer.provide(FSUtil.defaultLayer),
                Layer.provide(ripgrep),
                Layer.provide(
                  Layer.succeed(
                    Location.Service,
                    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
                  ),
                ),
              )
              const context = yield* Layer.build(layer)
              const service = Context.get(context, FileSystemSearch.Service)
              expect(calls).toEqual({ fff: 0, ripgrep: 0 })
              expect(yield* service.find({ query: "", type: "file", limit: 1 })).toEqual([])
            }),
          ),
        )
      }
      expect(calls).toEqual({ fff: 0, ripgrep: 1 })
    } finally {
      FileFinder.create = create
      Flag.KILO_DISABLE_FFF = disabled
    }
  })
})

describe("on-demand file search", () => {
  test("finds files and directories without a warmup scan", async () => {
    await search(async (service, directory) => {
      await fs.mkdir(path.join(directory, "src"))
      await fs.writeFile(path.join(directory, "src", "alpha.ts"), "export const alpha = 1\n")
      await fs.writeFile(path.join(directory, "beta.ts"), "export const beta = 2\n")

      const files = await Effect.runPromise(service.find({ query: "", type: "file" }))
      expect(files.map((item) => String(item.path)).sort()).toEqual(["beta.ts", "src/alpha.ts"])
      const match = await Effect.runPromise(service.find({ query: " alpts ", type: "file", limit: 1 }))
      expect(match.map((item) => String(item.path))).toEqual(["src/alpha.ts"])
      const directories = await Effect.runPromise(service.find({ query: "src", type: "directory" }))
      expect(directories).toEqual([{ path: RelativePath.make(`src${path.sep}`), type: "directory" }])
      const mixed = await Effect.runPromise(service.find({ query: "" }))
      expect(mixed.map((item) => item.type).sort()).toEqual(["directory", "file", "file"])
    })
  })

  test("sees added, renamed, and deleted files on the next request", async () => {
    await search(async (service, directory) => {
      expect(await Effect.runPromise(service.find({ query: "", type: "file" }))).toEqual([])
      await fs.writeFile(path.join(directory, "added.ts"), "export const added = 1\n")
      expect(
        (await Effect.runPromise(service.find({ query: "", type: "file" }))).map((item) => String(item.path)),
      ).toEqual(["added.ts"])
      await fs.rename(path.join(directory, "added.ts"), path.join(directory, "renamed.ts"))
      expect(
        (await Effect.runPromise(service.find({ query: "", type: "file" }))).map((item) => String(item.path)),
      ).toEqual(["renamed.ts"])
      await fs.unlink(path.join(directory, "renamed.ts"))
      expect(await Effect.runPromise(service.find({ query: "", type: "file" }))).toEqual([])
    })
  })

  test("reloads ignore rules and keeps hidden files out of file suggestions", async () => {
    await search(async (service, directory) => {
      await $`git init --quiet`.cwd(directory).quiet()
      await fs.writeFile(path.join(directory, ".gitignore"), "ignored.ts\n")
      await fs.writeFile(path.join(directory, "ignored.ts"), "export const ignored = 1\n")
      await fs.writeFile(path.join(directory, ".hidden.ts"), "export const hidden = 2\n")
      await fs.writeFile(path.join(directory, "visible.ts"), "export const visible = 3\n")
      expect(
        (await Effect.runPromise(service.find({ query: "", type: "file" }))).map((item) => String(item.path)),
      ).toEqual(["visible.ts"])
      await fs.writeFile(path.join(directory, ".gitignore"), "")
      expect(
        (await Effect.runPromise(service.find({ query: "", type: "file" }))).map((item) => String(item.path)).sort(),
      ).toEqual(["ignored.ts", "visible.ts"])
    })
  })

  test("keeps project-relative search results through a symlinked workspace", async () => {
    await search(
      async (service, directory) => {
        await fs.mkdir(path.join(directory, "src"))
        await fs.writeFile(path.join(directory, "src", "match.ts"), "needle\n")
        const files = await Effect.runPromise(service.find({ query: "match", type: "file" }))
        const glob = await Effect.runPromise(service.glob({ pattern: "*.ts", path: RelativePath.make("src") }))
        const grep = await Effect.runPromise(service.grep({ pattern: "needle", path: RelativePath.make("src") }))
        expect(files.map((item) => String(item.path))).toEqual(["src/match.ts"])
        expect(glob.map((item) => String(item.path))).toEqual([path.join("src", "match.ts")])
        expect(grep.map((item) => String(item.entry.path))).toEqual([path.join("src", "match.ts")])
      },
      { alias: true },
    )
  })

  test("keeps glob and grep results current and scoped", async () => {
    await search(async (service, directory) => {
      await fs.mkdir(path.join(directory, "src"))
      const input = { pattern: "**/*.ts", path: RelativePath.make("src") }
      expect(await Effect.runPromise(service.glob(input))).toEqual([])
      await fs.writeFile(path.join(directory, "src", "match.ts"), "needle\n")
      await fs.writeFile(path.join(directory, "outside.ts"), "needle\n")
      expect((await Effect.runPromise(service.glob(input))).map((item) => String(item.path))).toEqual([
        path.join("src", "match.ts"),
      ])
      const matches = await Effect.runPromise(service.grep({ pattern: "needle", path: RelativePath.make("src") }))
      expect(matches.map((item) => String(item.entry.path))).toEqual([path.join("src", "match.ts")])
      await fs.writeFile(path.join(directory, "src", "match.ts"), "changed\n")
      expect(await Effect.runPromise(service.grep({ pattern: "needle", path: RelativePath.make("src") }))).toEqual([])
    })
  })
})

describe("FFF lifecycle", () => {
  test("rechecks a changed symlink before creating a picker and retries with the canonical path", async () => {
    await using tmp = await tmpdir()
    const project = path.join(tmp.path, "project")
    const link = path.join(tmp.path, "link")
    const type = process.platform === "win32" ? "junction" : "dir"
    await fs.mkdir(project)
    await fs.symlink(project, link, type)
    const create = FileFinder.create
    const calls: InitOptions[] = []
    FileFinder.create = (opts) => {
      calls.push(opts)
      return { ok: false, error: "native creation intercepted" }
    }

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { FileSystemSearch } = yield* Effect.promise(() => import("@opencode-ai/core/filesystem/search"))
            const layer = FileSystemSearch.fffLayer.pipe(
              Layer.provide(FSUtil.defaultLayer),
              Layer.provide(
                Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(link) }))),
              ),
            )
            const context = yield* Layer.build(layer)
            const service = Context.get(context, FileSystemSearch.Service)
            expect(calls).toEqual([])
            yield* Effect.promise(async () => {
              await fs.unlink(link)
              await fs.symlink(path.parse(project).root, link, type)
            })

            for (const effect of [
              service.find({ query: "", type: "file", limit: 1 }).pipe(Effect.asVoid),
              service.glob({ pattern: "*", limit: 1 }).pipe(Effect.asVoid),
              service.grep({ pattern: "needle", limit: 1 }).pipe(Effect.asVoid),
            ]) {
              const result = yield* Effect.exit(effect)
              expect(result._tag).toBe("Failure")
              if (result._tag === "Failure") {
                expect(Cause.pretty(result.cause)).toContain("FFF indexing is disabled for filesystem roots.")
              }
            }
            expect(calls).toEqual([])

            yield* Effect.promise(async () => {
              await fs.unlink(link)
              await fs.symlink(project, link, type)
            })
            yield* Effect.exit(service.find({ query: "", type: "file", limit: 1 }))
            expect(calls).toHaveLength(1)
            expect(calls[0].basePath).toBe(project)
          }),
        ),
      )
    } finally {
      FileFinder.create = create
    }
  })

  test("retries a failed first search and reuses one picker", async () => {
    if (!Fff.available()) return

    const dir = await tmpdir()
    expect(allowed(dir.path)).toBe(true)
    const create = FileFinder.create
    const calls = { create: 0, destroy: 0, opts: undefined as InitOptions | undefined }
    try {
      FileFinder.create = (opts) => {
        calls.create++
        if (calls.create === 1) return { ok: false, error: "transient failure" }
        calls.opts = opts
        const result = create(opts)
        if (!result.ok) return result
        const destroy = result.value.destroy.bind(result.value)
        result.value.destroy = () => {
          calls.destroy++
          destroy()
        }
        return result
      }

      await Effect.runPromise(
        Effect.acquireUseRelease(
          Scope.make(),
          (scope) =>
            Effect.gen(function* () {
              const { FileSystemSearch } = yield* Effect.promise(() => import("@opencode-ai/core/filesystem/search"))
              const layer = FileSystemSearch.fffLayer.pipe(
                Layer.provide(FSUtil.defaultLayer),
                Layer.provide(
                  Layer.succeed(
                    Location.Service,
                    Location.Service.of(
                      location(
                        { directory: AbsolutePath.make(dir.path) },
                        { vcs: { type: "git", store: AbsolutePath.make(path.join(dir.path, ".git")) } },
                      ),
                    ),
                  ),
                ),
              )
              const context = yield* Layer.buildWithScope(layer, scope)
              const service = Context.get(context, FileSystemSearch.Service)
              expect(calls.create).toBe(0)

              const first = yield* Effect.exit(
                Effect.all(
                  [
                    service.find({ query: "", type: "file", limit: 1 }),
                    service.find({ query: "", type: "file", limit: 1 }),
                  ],
                  { concurrency: "unbounded" },
                ),
              )
              expect(first._tag).toBe("Failure")
              expect(calls.create).toBe(1)

              yield* service.find({ query: "", type: "file", limit: 1 })
              expect(calls.create).toBe(2)
              expect(calls.opts?.disableMmapCache).toBe(true)
              expect(calls.opts?.disableContentIndexing).toBe(true)
              expect(calls.opts).not.toHaveProperty("enableFsRootScanning")
              expect(calls.opts).not.toHaveProperty("enableHomeDirScanning")

              yield* service.find({ query: "", type: "file", limit: 1 })
              expect(calls.create).toBe(2)
              expect(calls.destroy).toBe(0)
            }),
          (scope, exit) => Scope.close(scope, exit),
        ),
      )
      expect(calls.destroy).toBe(1)
    } finally {
      FileFinder.create = create
      await dir[Symbol.asyncDispose]()
    }
  })
})
