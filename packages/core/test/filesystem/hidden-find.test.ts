import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Flag } from "@opencode-ai/core/flag/flag"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { it } from "../lib/effect"

// #14234: `@` mentions are served by FileSystem.find (GET /find/file) and must include dotfiles.
const provide = (directory: string) =>
  Effect.provide(
    LayerNode.compile(FileSystem.node, [
      [
        Location.node,
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
      ],
    ]),
  )

const withTmp = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))

const write = (directory: string, file: string) =>
  Effect.promise(async () => {
    await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true })
    await fs.writeFile(path.join(directory, file), "x\n")
  })

// Files must exist before the layer is built: the search index/scan starts at construction.
const seeded = <A, E, R>(files: string[], f: () => Effect.Effect<A, E, R>) =>
  withTmp((directory) =>
    Effect.gen(function* () {
      for (const file of files) yield* write(directory, file)
      // Force the ripgrep backend (FFF is the default on Linux/macOS); the layer is chosen when it is built.
      const previous = Flag.KILO_DISABLE_FFF
      Flag.KILO_DISABLE_FFF = true
      return yield* f().pipe(
        provide(directory),
        Effect.ensuring(Effect.sync(() => void (Flag.KILO_DISABLE_FFF = previous))),
      )
    }),
  )

// The ripgrep fallback scans in a forked fiber, so wait until the normal file is indexed before asserting.
const ready = (service: FileSystem.Interface) =>
  Effect.gen(function* () {
    for (let i = 0; i < 100; i++) {
      const found = yield* service.find({ query: "visible", type: "file", limit: 5 })
      if (found.length > 0) return
      yield* Effect.sleep("50 millis")
    }
  })

describe("FileSystem.find hidden entries in a non-git directory", () => {
  it.live("returns dotfiles and dot directories for @ mentions", () =>
    seeded(["visible.ts", ".env", ".hidden.ts", ".github/workflows/ci.yml"], () =>
      Effect.gen(function* () {
        const service = yield* FileSystem.Service
        yield* ready(service)
        const find = (query: string, type?: "file" | "directory") =>
          service
            .find({ query, type, limit: 50 })
            .pipe(Effect.map((items) => items.map((item) => item.path.replaceAll("\\", "/"))))
        expect(yield* find("visible", "file")).toContain("visible.ts")
        expect(yield* find("env", "file")).toContain(".env")
        expect(yield* find("hidden", "file")).toContain(".hidden.ts")
        expect(yield* find("ci.yml", "file")).toContain(".github/workflows/ci.yml")
        expect(yield* find("github", "directory")).toContain(".github/")
      }),
    ),
  )

  it.live("never returns .git contents", () =>
    seeded(["visible.ts", ".env", ".git/config"], () =>
      Effect.gen(function* () {
        const service = yield* FileSystem.Service
        yield* ready(service)
        const find = (query: string) =>
          service
            .find({ query, limit: 50 })
            .pipe(Effect.map((items) => items.map((item) => item.path.replaceAll("\\", "/"))))
        // Guard for the fix: opting in to hidden entries must keep .git itself excluded.
        for (const query of ["git", "config", ".git"]) {
          expect((yield* find(query)).filter((item) => item === ".git/" || item.startsWith(".git/"))).toEqual([])
        }
      }),
    ),
  )

  it.live("never returns a .git file (worktrees, submodules)", () =>
    seeded(["visible.ts", ".git", "sub/.git"], () =>
      Effect.gen(function* () {
        const service = yield* FileSystem.Service
        yield* ready(service)
        const found = yield* service
          .find({ query: "git", limit: 50 })
          .pipe(Effect.map((items) => items.map((item) => item.path.replaceAll("\\", "/"))))
        expect(found.filter((item) => item === ".git" || item.endsWith("/.git"))).toEqual([])
      }),
    ),
  )
})
