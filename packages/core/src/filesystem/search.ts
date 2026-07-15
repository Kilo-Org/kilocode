export * as FileSystemSearch from "./search"

import os from "os" // kilocode_change
import path from "path"
import { Context, Effect, Layer, Scope } from "effect"
import { Fff } from "#fff"
import fuzzysort from "fuzzysort"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { Ripgrep } from "../ripgrep"
import { RelativePath } from "../schema"
import { Flag } from "../flag/flag"
import * as SearchTarget from "../kilocode/search-target" // kilocode_change

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
    yield* ripgrep
      .find({
        cwd: location.directory,
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
    return Service.of({
      glob: (input) =>
        Effect.gen(function* () {
          const target = yield* inspect(input.path) // kilocode_change
          const cwd = target.type === "file" ? path.dirname(target.path) : target.path // kilocode_change
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
                  // kilocode_change
                  (entry) =>
                    new FileSystem.Entry({
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
          const target = yield* inspect(input.path) // kilocode_change
          const cwd = target.type === "file" ? path.dirname(target.path) : target.path // kilocode_change
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
                  // kilocode_change
                  (match) =>
                    new FileSystem.Match({
                      ...match,
                      entry: new FileSystem.Entry({
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
          // kilocode_change
          const items =
            input.type === "file"
              ? state.files
              : input.type === "directory"
                ? state.directories
                : [...state.files, ...state.directories]
          return fuzzysort.go(input.query, items, { limit: input.limit ?? 50 }).map((item) => {
            const relative = item.target
            const type = relative.endsWith(path.sep) ? ("directory" as const) : ("file" as const)
            const clean = type === "directory" ? relative.slice(0, -path.sep.length) : relative
            const absolute = path.resolve(location.directory, clean)
            return new FileSystem.Entry({
              path: RelativePath.make(relative),
              type,
              mime: type === "directory" ? "application/x-directory" : FSUtil.mimeType(absolute),
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
    const fs = yield* FSUtil.Service // kilocode_change
    // kilocode_change start - FFF is an index, not a security boundary; constrain its scan and filter canonical results.
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
    const result = yield* Effect.try({
      try: () =>
        Fff.create({
          basePath: location.directory,
          aiMode: true,
          // kilocode_change start - permit broad scanning only when the Location is that exact boundary.
          enableFsRootScanning: location.directory === path.parse(location.directory).root,
          enableHomeDirScanning: location.directory === os.homedir(),
          // kilocode_change end
        }),
      catch: (cause) => cause,
    }).pipe(Effect.orDie)
    if (!result.ok) return yield* Effect.die(result.error)
    yield* Effect.addFinalizer(() => Effect.sync(() => result.value.destroy()).pipe(Effect.ignore))
    return Service.of({
      glob: (input) =>
        Effect.gen(function* () {
          const { root, target } = yield* inspect(input.path) // kilocode_change
          const prefix = input.path?.replaceAll("\\", "/").replace(/\/$/, "")
          const found = yield* Effect.sync(() =>
            // kilocode_change
            result.value.glob(prefix ? `${prefix}/${input.pattern}` : input.pattern, {
              pageIndex: 0,
              pageSize: input.limit,
            }),
          )
          if (!found.ok) throw found.error
          yield* SearchTarget.validate(fs, target).pipe(Effect.orDie) // kilocode_change
          const items = yield* Effect.filter(found.value.items, (item) => safe(root, item.relativePath)) // kilocode_change
          return items.map((item) => {
            // kilocode_change
            const absolute = path.resolve(location.directory, item.relativePath)
            return new FileSystem.Entry({
              path: RelativePath.make(item.relativePath.replaceAll("\\", "/")),
              type: "file",
              mime: FSUtil.mimeType(absolute),
            })
          })
        }),
      grep: (input) =>
        Effect.gen(function* () {
          // kilocode_change
          const { root, target } = yield* inspect(input.path) // kilocode_change
          const prefix = input.path?.replaceAll("\\", "/").replace(/\/$/, "")
          const found = yield* Effect.sync(() =>
            // kilocode_change
            result.value.grep(
              [prefix ? `${prefix}/**` : undefined, input.include, input.pattern]
                .filter((value) => value !== undefined)
                .join(" "),
              { mode: "regex", pageSize: input.limit, timeBudgetMs: 1_500 },
            ),
          )
          if (!found.ok) throw found.error
          yield* SearchTarget.validate(fs, target).pipe(Effect.orDie) // kilocode_change
          const items = yield* Effect.filter(found.value.items, (item) => safe(root, item.relativePath)) // kilocode_change
          return items.map((match) => {
            // kilocode_change
            const bytes = Buffer.from(match.lineContent)
            return new FileSystem.Match({
              entry: new FileSystem.Entry({
                path: RelativePath.make(match.relativePath.replaceAll("\\", "/")),
                type: "file",
                mime: FSUtil.mimeType(match.relativePath),
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
        }),
      find: (input) =>
        Effect.sync(() => {
          const options = { pageIndex: 0, pageSize: input.limit ?? 50 }
          const items = (() => {
            if (input.type === "file") {
              const found = result.value.fileSearch(input.query.trim(), options)
              if (!found.ok) throw found.error
              return found.value.items.map((item, index) => ({
                path: item.relativePath,
                type: "file" as const,
                score: found.value.scores[index]?.total ?? 0,
              }))
            }
            if (input.type === "directory") {
              const found = result.value.directorySearch(input.query.trim(), options)
              if (!found.ok) throw found.error
              return found.value.items.map((item, index) => ({
                path: item.relativePath,
                type: "directory" as const,
                score: found.value.scores[index]?.total ?? 0,
              }))
            }
            const found = result.value.mixedSearch(input.query.trim(), options)
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
              const absolute = path.resolve(location.directory, relative)
              return new FileSystem.Entry({
                path: RelativePath.make(relative + (item.type === "directory" ? path.sep : "")),
                type: item.type,
                mime: item.type === "directory" ? "application/x-directory" : FSUtil.mimeType(absolute),
              })
            })
        }),
    })
  }),
)

export const defaultLayer = Layer.unwrap(
  Effect.sync(() => (Flag.KILO_DISABLE_FFF || !Fff.available() ? ripgrepLayer : fffLayer)),
)
