export * as FileSystemSearch from "./search"

import { makeLocationNode } from "../effect/app-node"
import path from "path"
import { Context, Duration, Effect, Layer, Scope } from "effect"
import { Fff } from "#fff"
import fuzzysort from "fuzzysort"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { Ripgrep } from "../ripgrep"
import { RelativePath } from "../schema"
import { Flag } from "../flag/flag"
// kilocode_change start
import * as SearchTarget from "../kilocode/search-target"
import { allowed, message } from "../kilocode/fff"
// kilocode_change end

export interface Interface {
  readonly find: (input: FileSystem.FindInput) => Effect.Effect<FileSystem.Entry[]>
  readonly glob: (input: FileSystem.GlobInput) => Effect.Effect<readonly FileSystem.Entry[]>
  readonly grep: (input: FileSystem.GrepInput) => Effect.Effect<readonly FileSystem.Match[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileSystem/Search") {}

export const ripgrepLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const ripgrep = yield* Ripgrep.Service
    const scope = yield* Scope.Scope
    // kilocode_change start - confine every search to the canonical active Location.
    const inspect = Effect.fnUntraced(function* (input?: string) {
      const root = yield* SearchTarget.inspect(fs, location.directory).pipe(Effect.orDie)
      const requested = path.resolve(location.directory, input ?? ".")
      if (!FSUtil.contains(location.directory, requested))
        return yield* Effect.die(new Error("Path escapes the location"))
      const target = yield* SearchTarget.inspect(fs, requested).pipe(Effect.orDie)
      if (root.type !== "directory" || !FSUtil.contains(root.path, target.path))
        return yield* Effect.die(new Error("Path escapes the location"))
      return target
    })
    // kilocode_change end
    const state = {
      files: [] as string[],
      directories: [] as string[],
    }
    const directories = new Set<string>()
    // kilocode_change start - never eagerly enumerate a filesystem root.
    const real = yield* fs.realPath(location.directory).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (real && allowed(real)) {
      yield* ripgrep
        .find({
          cwd: real,
          pattern: "*",
          limit: location.vcs ? Number.MAX_SAFE_INTEGER : 100_000,
          onEntry: (entry) =>
            Effect.sync(() => {
              state.files.push(entry.path)
              const parts = entry.path.split("/")
              parts.slice(0, -1).forEach((_, index) => directories.add(parts.slice(0, index + 1).join("/") + path.sep))
              state.directories = Array.from(directories)
            }),
        })
        .pipe(Effect.orDie, Effect.asVoid, Effect.forkIn(scope))
    }
    // kilocode_change end
    return Service.of({
      glob: (input) =>
        Effect.gen(function* () {
          // kilocode_change start
          const target = yield* inspect(input.path)
          const cwd = target.type === "file" ? path.dirname(target.path) : target.path
          // kilocode_change end
          return yield* ripgrep
            .glob({
              cwd,
              pattern: input.pattern,
              limit: input.limit ?? Number.MAX_SAFE_INTEGER,
              validate: SearchTarget.validate(fs, target), // kilocode_change
            })
            .pipe(
              Effect.map((result) =>
                result.items.map(
                  // kilocode_change - validate wraps results in SearchResult
                  (entry) =>
                    FileSystem.Entry.make({
                      ...entry,
                      path: RelativePath.make(path.relative(location.directory, path.resolve(cwd, entry.path))),
                    }),
                ),
              ),
              Effect.orDie,
            )
        }),
      grep: (input) =>
        Effect.gen(function* () {
          // kilocode_change start
          const target = yield* inspect(input.path)
          const cwd = target.type === "file" ? path.dirname(target.path) : target.path
          // kilocode_change end
          return yield* ripgrep
            .grep({
              cwd,
              pattern: input.pattern,
              file: target.type === "file" ? path.basename(target.path) : undefined, // kilocode_change
              include: input.include,
              limit: input.limit ?? Number.MAX_SAFE_INTEGER,
              validate: SearchTarget.validate(fs, target), // kilocode_change
            })
            .pipe(
              Effect.map((result) =>
                result.items.map(
                  // kilocode_change - validate wraps results in SearchResult
                  (match) =>
                    FileSystem.Match.make({
                      ...match,
                      entry: FileSystem.Entry.make({
                        ...match.entry,
                        path: RelativePath.make(path.relative(location.directory, path.resolve(cwd, match.entry.path))),
                      }),
                    }),
                ),
              ),
              Effect.orDie,
            )
        }),
      find: (input) =>
        Effect.gen(function* () {
          const items =
            input.type === "file"
              ? state.files
              : input.type === "directory"
                ? state.directories
                : [...state.files, ...state.directories]
          return fuzzysort.go(input.query, items, { limit: input.limit ?? 50 }).map((item) => {
            const relative = item.target
            const type = relative.endsWith(path.sep) ? ("directory" as const) : ("file" as const)
            return FileSystem.Entry.make({
              path: RelativePath.make(relative),
              type,
            })
          })
        }),
    })
  }),
)

export const fffLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    // kilocode_change start
    const fs = yield* FSUtil.Service
    const inspect = Effect.fnUntraced(function* (input?: string) {
      const root = yield* SearchTarget.inspect(fs, location.directory).pipe(Effect.orDie)
      const requested = path.resolve(location.directory, input ?? ".")
      if (!FSUtil.contains(location.directory, requested))
        return yield* Effect.die(new Error("Path escapes the location"))
      const target = yield* SearchTarget.inspect(fs, requested).pipe(Effect.orDie)
      if (root.type !== "directory" || !FSUtil.contains(root.path, target.path))
        return yield* Effect.die(new Error("Path escapes the location"))
      return { root, target }
    })
    const safe = Effect.fnUntraced(function* (root: SearchTarget.Target, relative: string) {
      const absolute = path.resolve(location.directory, relative)
      if (!FSUtil.contains(location.directory, absolute)) return false
      const real = yield* fs.realPath(absolute).pipe(Effect.catch(() => Effect.succeed(undefined)))
      return real !== undefined && FSUtil.contains(root.path, real)
    })
    // kilocode_change end
    // kilocode_change start - defer FFF until search because other location consumers do not need its native index.
    const scope = yield* Scope.Scope
    const release = (entry: { finder: { destroy(): void }; closed: boolean }) =>
      Effect.sync(() => {
        if (entry.closed) return
        entry.closed = true
        entry.finder.destroy()
      }).pipe(Effect.ignore)
    const make = Effect.uninterruptible(
      Effect.gen(function* () {
        const real = yield* fs.realPath(location.directory).pipe(Effect.orDie)
        if (!allowed(real)) return yield* Effect.die(new Error(message))
        const result = yield* Effect.try({
          try: () =>
            Fff.create({
              basePath: real,
              aiMode: true,
              disableMmapCache: true,
              disableContentIndexing: true,
            }),
          catch: (cause) => cause,
        }).pipe(Effect.orDie)
        if (!result.ok) return yield* Effect.die(result.error)
        const entry = { finder: result.value, closed: false }
        yield* Scope.addFinalizer(scope, release(entry))
        return entry
      }),
    )
    const [load, invalidate] = yield* Effect.cachedInvalidateWithTTL(
      make.pipe(
        Effect.flatMap((entry) =>
          Effect.promise(() => entry.finder.waitForScan())
            .pipe(
              Effect.orDie,
              Effect.onError(() => release(entry)),
            )
            .pipe(
              Effect.flatMap((scan) => {
                if (!scan.ok || !scan.value) return Effect.die(new Error("FFF initial scan did not complete"))
                return Effect.succeed(entry)
              }),
            ),
        ),
      ),
      Duration.infinity,
    )
    const get = load.pipe(Effect.onError(() => invalidate))
    yield* Scope.addFinalizer(scope, invalidate)
    // kilocode_change end
    return Service.of({
      glob: (input) =>
        // kilocode_change start
        Effect.gen(function* () {
          const { root, target } = yield* inspect(input.path)
          const result = yield* get
          // kilocode_change end
          const prefix = input.path?.replaceAll("\\", "/").replace(/\/$/, "")
          // kilocode_change start
          const found = yield* Effect.sync(() =>
            result.finder.glob(prefix ? `${prefix}/${input.pattern}` : input.pattern, {
              pageIndex: 0,
              pageSize: input.limit,
            }),
          )
          // kilocode_change end
          if (!found.ok) throw found.error
          // kilocode_change start
          yield* SearchTarget.validate(fs, target).pipe(Effect.orDie)
          const items = yield* Effect.filter(found.value.items, (item) => safe(root, item.relativePath))
          return items.map((item) =>
            FileSystem.Entry.make({
              path: RelativePath.make(item.relativePath.replaceAll("\\", "/")),
              type: "file",
            }),
          )
          // kilocode_change end
        }),
      grep: (input) =>
        // kilocode_change start
        Effect.gen(function* () {
          const { root, target } = yield* inspect(input.path)
          const result = yield* get
          // kilocode_change end
          const prefix = input.path?.replaceAll("\\", "/").replace(/\/$/, "")
          // kilocode_change start
          const found = yield* Effect.sync(
            () =>
              result.finder.grep(
                [prefix ? `${prefix}/**` : undefined, input.include, input.pattern]
                  .filter((value) => value !== undefined)
                  .join(" "),
                { mode: "regex", pageSize: input.limit, timeBudgetMs: 1_500 },
              ),
            // kilocode_change end
          )
          if (!found.ok) throw found.error
          // kilocode_change start
          yield* SearchTarget.validate(fs, target).pipe(Effect.orDie)
          const items = yield* Effect.filter(found.value.items, (item) => safe(root, item.relativePath))
          return items.map((match) => {
            const bytes = Buffer.from(match.lineContent)
            return FileSystem.Match.make({
              entry: FileSystem.Entry.make({
                path: RelativePath.make(match.relativePath.replaceAll("\\", "/")),
                type: "file",
              }),
              line: match.lineNumber,
              offset: match.byteOffset,
              text: match.lineContent.length > 2_000 ? match.lineContent.slice(0, 2_000) + "..." : match.lineContent,
              submatches: match.matchRanges.map(([start, end]) => ({
                text: bytes.subarray(start, end).toString("utf8"),
                start,
                end,
              })),
            })
          })
          // kilocode_change end
        }),
      find: (input) =>
        Effect.gen(function* () {
          // kilocode_change - load the native index only for an actual search.
          const result = yield* get // kilocode_change
          const options = { pageIndex: 0, pageSize: input.limit ?? 50 }
          const items = (() => {
            if (input.type === "file") {
              const found = result.finder.fileSearch(input.query.trim(), options)
              if (!found.ok) throw found.error
              return found.value.items.map((item, index) => ({
                path: item.relativePath,
                type: "file" as const,
                score: found.value.scores[index]?.total ?? 0,
              }))
            }
            if (input.type === "directory") {
              const found = result.finder.directorySearch(input.query.trim(), options)
              if (!found.ok) throw found.error
              return found.value.items.map((item, index) => ({
                path: item.relativePath,
                type: "directory" as const,
                score: found.value.scores[index]?.total ?? 0,
              }))
            }
            const found = result.finder.mixedSearch(input.query.trim(), options)
            if (!found.ok) throw found.error
            return found.value.items.map((item, index) => ({
              path: item.item.relativePath,
              type: item.type,
              score: found.value.scores[index]?.total ?? 0,
            }))
          })()
          return items
            .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
            .map((item) => {
              const relative = item.path.replaceAll("\\", "/").replace(/\/$/, "")
              return FileSystem.Entry.make({
                path: RelativePath.make(relative + (item.type === "directory" ? path.sep : "")),
                type: item.type,
              })
            })
        }),
    })
  }),
)

// kilocode_change start - FFF owns an initial scan and watcher, so roots must use the non-indexing fallback.
const layer = Layer.unwrap(
  Effect.gen(function* () {
    if (Flag.KILO_DISABLE_FFF || !Fff.available()) return ripgrepLayer
    const location = yield* Location.Service
    const fs = yield* FSUtil.Service
    const real = yield* fs.realPath(location.directory).pipe(Effect.catch(() => Effect.succeed(undefined)))
    return real && allowed(real) ? fffLayer : ripgrepLayer
  }),
)
// kilocode_change end

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [FSUtil.node, Location.node, Ripgrep.node] })
