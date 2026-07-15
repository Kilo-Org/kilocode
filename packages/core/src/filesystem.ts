export * as FileSystem from "./filesystem"

import path from "path"
import { Context, Effect, Layer, Option, Schema } from "effect" // kilocode_change
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"
import { Location } from "./location"
import { PositiveInt, RelativePath } from "./schema"
import { FileSystemSearch } from "./filesystem/search"
import { Entry, Match } from "./filesystem/schema"
import * as SearchTarget from "./kilocode/search-target" // kilocode_change
export { Entry, Match, Submatch } from "./filesystem/schema"

export const ReadInput = Schema.Struct({
  path: RelativePath,
})
export type ReadInput = typeof ReadInput.Type

export const Content = Schema.Struct({
  uri: Schema.String,
  name: Schema.String.pipe(Schema.optional),
  content: Schema.String,
  encoding: Schema.Literals(["utf8", "base64"]),
  mime: Schema.String,
}).annotate({ identifier: "FileSystem.Content" })
export type Content = typeof Content.Type

export const ListInput = Schema.Struct({
  path: RelativePath.pipe(Schema.optional),
})
export type ListInput = typeof ListInput.Type

export class FindInput extends Schema.Class<FindInput>("FileSystem.FindInput")({
  query: Schema.String,
  type: Schema.Literals(["file", "directory"]).pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
}) {}

export const DEFAULT_SEARCH_LIMIT = 100 // kilocode_change - preserve bounded Kilo tool searches
export const MAX_SEARCH_LIMIT = 100 // kilocode_change
export const SearchLimit = PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_SEARCH_LIMIT)) // kilocode_change

export class GlobInput extends Schema.Class<GlobInput>("FileSystem.GlobInput")({
  pattern: Schema.String,
  path: RelativePath.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
}) {}

export class GrepInput extends Schema.Class<GrepInput>("FileSystem.GrepInput")({
  pattern: Schema.String,
  path: RelativePath.pipe(Schema.optional),
  include: Schema.String.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
}) {}

export const Event = {
  Edited: EventV2.define({
    type: "file.edited",
    schema: {
      file: Schema.String,
    },
  }),
}

export interface Interface {
  readonly read: (input: ReadInput) => Effect.Effect<{ readonly content: Uint8Array; readonly mime: string }>
  readonly list: (input?: ListInput) => Effect.Effect<Entry[]>
  readonly find: (input: FindInput) => Effect.Effect<Entry[]>
  readonly glob: (input: GlobInput) => Effect.Effect<readonly Entry[]>
  readonly grep: (input: GrepInput) => Effect.Effect<readonly Match[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileSystem") {}

const baseLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const search = yield* FileSystemSearch.Service
    const root = yield* fs.realPath(location.directory).pipe(Effect.orDie)
    const resolve = Effect.fnUntraced(function* (input?: RelativePath) {
      const absolute = path.resolve(location.directory, input ?? ".")
      if (!FSUtil.contains(location.directory, absolute))
        return yield* Effect.die(new Error("Path escapes the location"))
      const real = yield* fs.realPath(absolute).pipe(Effect.orDie)
      if (!FSUtil.contains(root, real)) return yield* Effect.die(new Error("Path escapes the location"))
      const target = yield* SearchTarget.inspect(fs, real).pipe(Effect.orDie) // kilocode_change
      return { absolute, real, directory: location.directory, root, target } // kilocode_change
    })
    return Service.of({
      find: search.find,
      glob: search.glob,
      grep: search.grep,
      read: Effect.fn("FileSystem.read")(function* (input) {
        const target = yield* resolve(input.path)
        if (target.target.type !== "file") return yield* Effect.die(new Error("Path is not a file")) // kilocode_change
        // kilocode_change start - read from the validated descriptor, not a second pathname lookup.
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const file = yield* fs.open(target.real, { flag: "r" }).pipe(Effect.orDie)
            const info = yield* file.stat.pipe(Effect.orDie)
            if (
              info.type !== "File" ||
              info.dev !== target.target.dev ||
              Option.getOrUndefined(info.ino) !== target.target.ino
            )
              return yield* Effect.die(new Error("Path changed during read"))
            const chunks: Uint8Array[] = []
            while (true) {
              const chunk = yield* file.readAlloc(64 * 1024).pipe(Effect.orDie)
              if (Option.isNone(chunk)) break
              chunks.push(chunk.value)
            }
            return {
              content: new Uint8Array(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))),
              mime: FSUtil.mimeType(target.real),
            }
          }),
        )
        // kilocode_change end
      }),
      list: Effect.fn("FileSystem.list")(function* (input = {}) {
        const target = yield* resolve(input.path)
        if (target.target.type !== "directory") return yield* Effect.die(new Error("Path is not a directory")) // kilocode_change
        // kilocode_change start - reject directory replacement during enumeration
        yield* SearchTarget.validate(fs, target.target).pipe(Effect.orDie)
        const entries = yield* fs.readDirectoryEntries(target.real).pipe(
          Effect.orDie,
          Effect.map((items) =>
            items
              .flatMap((item) => {
                if (item.type !== "file" && item.type !== "directory") return []
                const absolute = path.join(target.absolute, item.name)
                const relative = path.relative(target.directory, absolute)
                return [
                  new Entry({
                    path: RelativePath.make(relative + (item.type === "directory" ? path.sep : "")),
                    type: item.type,
                    mime: item.type === "directory" ? "application/x-directory" : FSUtil.mimeType(absolute),
                  }),
                ]
              })
              .sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1)),
          ),
        )
        yield* SearchTarget.validate(fs, target.target).pipe(Effect.orDie)
        return entries
        // kilocode_change end
      }),
    })
  }),
)

export const layer = baseLayer.pipe(Layer.provide(FileSystemSearch.defaultLayer), Layer.provide(FSUtil.defaultLayer))

export const locationLayer = layer
