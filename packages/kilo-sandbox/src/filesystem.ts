import { dirname } from "node:path"
import { tmpdir } from "node:os"
import { Effect, FileSystem, Layer, PlatformError, Scope, Sink } from "effect"
import { assertEntry, assertPath, current } from "./context"
import { currentRunner } from "./mutation"
import { date, type Request } from "./mutation-protocol"
import type { Profile } from "./profile"

interface TempOptions {
  readonly directory?: string | undefined
  readonly prefix?: string | undefined
  readonly suffix?: string | undefined
}

export function ensureDirectory(fs: FileSystem.FileSystem, path: string) {
  return fs.makeDirectory(path, { recursive: true }).pipe(
    Effect.catchIf(
      (err) => err.reason._tag === "AlreadyExists",
      () => Effect.void,
    ),
  )
}

function execute(profile: Profile, request: Request, effect: Effect.Effect<void, PlatformError.PlatformError>) {
  return Effect.gen(function* () {
    yield* effect
    yield* (yield* currentRunner)(profile, request)
  })
}

function openDenied(path: string) {
  return PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method: "open",
    pathOrDescriptor: path,
    description: "Writable file handles are unavailable while the sandbox is enabled",
  })
}

function tempOptions(profile: Profile, options: TempOptions | undefined) {
  const directory = options?.directory ?? profile.filesystem.temporaryDirectory ?? tmpdir()
  return { directory, options: { ...options, directory } }
}

function temporary(
  method: "makeTempDirectory" | "makeTempFile",
  options: TempOptions | undefined,
  create: (options?: TempOptions) => Effect.Effect<string, PlatformError.PlatformError>,
) {
  return Effect.gen(function* () {
    const profile = yield* current
    if (!profile) return yield* create(options)
    const temp = tempOptions(profile, options)
    yield* assertPath(temp.directory, method)
    const result = yield* (yield* currentRunner)(profile, { op: method, options: temp.options })
    if (result !== undefined) return result
    return yield* Effect.fail(
      PlatformError.systemError({
        _tag: "Unknown",
        module: "Sandbox",
        method,
        pathOrDescriptor: temp.directory,
        description: "Filesystem worker returned no temporary path",
      }),
    )
  })
}

function scoped(
  method: "makeTempDirectory" | "makeTempFile",
  options: TempOptions | undefined,
  create: (options?: TempOptions) => Effect.Effect<string, PlatformError.PlatformError, Scope.Scope>,
) {
  return Effect.gen(function* () {
    const profile = yield* current
    if (!profile) return yield* create(options)
    const temp = tempOptions(profile, options)
    yield* assertPath(temp.directory, method)
    const runner = yield* currentRunner
    return yield* Effect.acquireRelease(
      runner(profile, { op: method, options: temp.options }).pipe(
        Effect.flatMap((result) =>
          result === undefined
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "Unknown",
                  module: "Sandbox",
                  method,
                  pathOrDescriptor: temp.directory,
                  description: "Filesystem worker returned no temporary path",
                }),
              )
            : Effect.succeed(result),
        ),
      ),
      (path) =>
        runner(profile, {
          op: "remove",
          path: method === "makeTempFile" ? dirname(path) : path,
          options: { recursive: true },
        }).pipe(Effect.orDie),
    )
  })
}

export function decorateFileSystem(fs: FileSystem.FileSystem): FileSystem.FileSystem {
  return FileSystem.FileSystem.of({
    ...fs,
    chmod: (path, mode) =>
      Effect.gen(function* () {
        const profile = yield* current
        if (!profile) return yield* fs.chmod(path, mode)
        return yield* execute(profile, { op: "chmod", path, mode }, assertPath(path, "chmod"))
      }),
    chown: (path, uid, gid) =>
      Effect.gen(function* () {
        const profile = yield* current
        if (!profile) return yield* fs.chown(path, uid, gid)
        return yield* execute(profile, { op: "chown", path, uid, gid }, assertPath(path, "chown"))
      }),
    copy: (from, to, options) =>
      Effect.gen(function* () {
        const profile = yield* current
        if (!profile) return yield* fs.copy(from, to, options)
        return yield* execute(profile, { op: "copy", from, to, options }, assertPath(to, "copy"))
      }),
    copyFile: (from, to) =>
      Effect.gen(function* () {
        const profile = yield* current
        if (!profile) return yield* fs.copyFile(from, to)
        return yield* execute(profile, { op: "copyFile", from, to }, assertPath(to, "copyFile"))
      }),
    link: (from, to) =>
      Effect.gen(function* () {
        const profile = yield* current
        if (!profile) return yield* fs.link(from, to)
        const check = assertPath(from, "link").pipe(Effect.andThen(assertPath(to, "link")))
        return yield* execute(profile, { op: "link", from, to }, check)
      }),
    makeDirectory: (path, options) =>
      Effect.gen(function* () {
        const profile = yield* current
        if (!profile) return yield* fs.makeDirectory(path, options)
        return yield* execute(profile, { op: "makeDirectory", path, options }, assertPath(path, "makeDirectory"))
      }),
    makeTempDirectory: (options) => temporary("makeTempDirectory", options, fs.makeTempDirectory),
    makeTempDirectoryScoped: (options) => scoped("makeTempDirectory", options, fs.makeTempDirectoryScoped),
    makeTempFile: (options) => temporary("makeTempFile", options, fs.makeTempFile),
    makeTempFileScoped: (options) => scoped("makeTempFile", options, fs.makeTempFileScoped),
    open: (path, options) =>
      Effect.gen(function* () {
        const profile = yield* current
        if (!profile || (options?.flag ?? "r") === "r") return yield* fs.open(path, options)
        yield* assertPath(path, "open")
        return yield* Effect.fail(openDenied(path))
      }),
    remove: (path, options) =>
      Effect.gen(function* () {
        const profile = yield* current
        if (!profile) return yield* fs.remove(path, options)
        return yield* execute(profile, { op: "remove", path, options }, assertEntry(path, "remove"))
      }),
    rename: (from, to) =>
      Effect.gen(function* () {
        const profile = yield* current
        if (!profile) return yield* fs.rename(from, to)
        const check = assertEntry(from, "rename").pipe(Effect.andThen(assertEntry(to, "rename")))
        return yield* execute(profile, { op: "rename", from, to }, check)
      }),
    sink: (path, options) =>
      Sink.unwrap(
        Effect.gen(function* () {
          const profile = yield* current
          if (!profile) return fs.sink(path, options)
          const runner = yield* currentRunner
          const collect = Sink.foldArray(
            () => [] as Uint8Array[],
            () => true,
            (chunks, input: ReadonlyArray<Uint8Array>) => Effect.sync(() => [...chunks, ...input]),
          )
          return Sink.mapEffect(collect, (chunks) => {
            const request: Request = {
              op: "writeFile",
              path,
              data: Buffer.concat(chunks).toString("base64"),
              options,
            }
            return assertPath(path, "sink").pipe(Effect.andThen(runner(profile, request)), Effect.asVoid)
          })
        }),
      ),
    symlink: (from, to) =>
      Effect.gen(function* () {
        const profile = yield* current
        if (!profile) return yield* fs.symlink(from, to)
        return yield* execute(profile, { op: "symlink", from, to }, assertPath(to, "symlink"))
      }),
    truncate: (path, length) =>
      Effect.gen(function* () {
        const profile = yield* current
        if (!profile) return yield* fs.truncate(path, length)
        return yield* execute(
          profile,
          { op: "truncate", path, length: length === undefined ? undefined : Number(length) },
          assertPath(path, "truncate"),
        )
      }),
    utimes: (path, atime, mtime) =>
      Effect.gen(function* () {
        const profile = yield* current
        if (!profile) return yield* fs.utimes(path, atime, mtime)
        return yield* execute(
          profile,
          { op: "utimes", path, atime: date(atime), mtime: date(mtime) },
          assertPath(path, "utimes"),
        )
      }),
    writeFile: (path, data, options) =>
      Effect.gen(function* () {
        const profile = yield* current
        if (!profile) return yield* fs.writeFile(path, data, options)
        return yield* execute(
          profile,
          { op: "writeFile", path, data: Buffer.from(data).toString("base64"), options },
          assertPath(path, "writeFile"),
        )
      }),
    writeFileString: (path, data, options) =>
      Effect.gen(function* () {
        const profile = yield* current
        if (!profile) return yield* fs.writeFileString(path, data, options)
        return yield* execute(
          profile,
          { op: "writeFileString", path, data, options },
          assertPath(path, "writeFileString"),
        )
      }),
  })
}

export const layer: Layer.Layer<FileSystem.FileSystem, never, FileSystem.FileSystem> = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    return decorateFileSystem(yield* FileSystem.FileSystem)
  }),
)
