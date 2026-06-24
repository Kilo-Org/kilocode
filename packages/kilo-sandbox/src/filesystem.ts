import { tmpdir } from "node:os"
import { Effect, FileSystem, Layer, Sink } from "effect"
import { assertEntry, assertPath, current } from "./context"

interface TempOptions {
  readonly directory?: string | undefined
  readonly prefix?: string | undefined
  readonly suffix?: string | undefined
}

function temp<E, R>(
  method: string,
  options: TempOptions | undefined,
  create: (options?: TempOptions) => Effect.Effect<string, E, R>,
) {
  return Effect.gen(function* () {
    const profile = yield* current
    if (!profile) return yield* create(options)
    const directory = options?.directory ?? profile.filesystem.temporaryDirectory ?? tmpdir()
    yield* assertPath(directory, method)
    return yield* create(
      options?.directory === undefined && profile.filesystem.temporaryDirectory
        ? { ...options, directory: profile.filesystem.temporaryDirectory }
        : options,
    )
  })
}

export function decorateFileSystem(fs: FileSystem.FileSystem): FileSystem.FileSystem {
  return FileSystem.FileSystem.of({
    ...fs,
    chmod: (path, mode) => assertPath(path, "chmod").pipe(Effect.andThen(fs.chmod(path, mode))),
    chown: (path, uid, gid) => assertPath(path, "chown").pipe(Effect.andThen(fs.chown(path, uid, gid))),
    copy: (from, to, options) => assertPath(to, "copy").pipe(Effect.andThen(fs.copy(from, to, options))),
    copyFile: (from, to) => assertPath(to, "copyFile").pipe(Effect.andThen(fs.copyFile(from, to))),
    link: (from, to) =>
      assertPath(from, "link").pipe(Effect.andThen(assertPath(to, "link")), Effect.andThen(fs.link(from, to))),
    makeDirectory: (path, options) =>
      assertPath(path, "makeDirectory").pipe(Effect.andThen(fs.makeDirectory(path, options))),
    makeTempDirectory: (options) => temp("makeTempDirectory", options, fs.makeTempDirectory),
    makeTempDirectoryScoped: (options) => temp("makeTempDirectoryScoped", options, fs.makeTempDirectoryScoped),
    makeTempFile: (options) => temp("makeTempFile", options, fs.makeTempFile),
    makeTempFileScoped: (options) => temp("makeTempFileScoped", options, fs.makeTempFileScoped),
    open: (path, options) => {
      if ((options?.flag ?? "r") === "r") return fs.open(path, options)
      return assertPath(path, "open").pipe(Effect.andThen(fs.open(path, options)))
    },
    remove: (path, options) => assertEntry(path, "remove").pipe(Effect.andThen(fs.remove(path, options))),
    rename: (from, to) =>
      assertEntry(from, "rename").pipe(Effect.andThen(assertEntry(to, "rename")), Effect.andThen(fs.rename(from, to))),
    sink: (path, options) => Sink.unwrap(Effect.map(assertPath(path, "sink"), () => fs.sink(path, options))),
    symlink: (from, to) => assertPath(to, "symlink").pipe(Effect.andThen(fs.symlink(from, to))),
    truncate: (path, length) => assertPath(path, "truncate").pipe(Effect.andThen(fs.truncate(path, length))),
    utimes: (path, atime, mtime) => assertPath(path, "utimes").pipe(Effect.andThen(fs.utimes(path, atime, mtime))),
    writeFile: (path, data, options) =>
      assertPath(path, "writeFile").pipe(Effect.andThen(fs.writeFile(path, data, options))),
    writeFileString: (path, data, options) =>
      assertPath(path, "writeFileString").pipe(Effect.andThen(fs.writeFileString(path, data, options))),
  })
}

export const layer: Layer.Layer<FileSystem.FileSystem, never, FileSystem.FileSystem> = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    return decorateFileSystem(yield* FileSystem.FileSystem)
  }),
)
