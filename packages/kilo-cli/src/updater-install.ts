import { Effect, FileSystem, Option, Schema } from "effect"
import path from "node:path"
import { isPreview } from "./update-version"

// The v2 CLI is published as a compiled launcher whose postinstall copies the platform binary into `bin/kilo2.exe`.
// A source checkout runs under Bun, and the v1 line uses the same package name, so ownership is decided from the
// installed package manifest and the running executable rather than from a global package list.
export const packageName = "@kilocode/cli"

// A scoped registry in an npmrc can redirect `@kilocode/*` away from npmjs. npm and pnpm accept an explicit scoped
// registry flag, and Yarn Classic can ignore its rc files and use only the registry flag. Bun has no way to override
// a scoped registry, so a Bun global is not updated automatically: it could install a platform package from another
// registry.
export const registry = "https://registry.npmjs.org"

export type Method = "npm" | "pnpm" | "yarn"

export interface Install {
  readonly method: Method
  /** The package manifest of the global install. For pnpm this is the global root, so it follows a new install. */
  readonly manifest: string
  /** pnpm can move its one-package group to a new hash when the install command pins the registry. */
  readonly installedManifest?: Effect.Effect<string | undefined>
  readonly scriptsSetting?: string[]
  readonly command: (version: string) => string[]
}

export interface CommandResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export type Exec = (command: string[]) => Effect.Effect<CommandResult, Error>

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    version: Schema.String,
    bin: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
)
const decodeManifest = Schema.decodeUnknownOption(Manifest)

const resolved = (fs: FileSystem.FileSystem, file: string) => fs.realPath(file).pipe(Effect.orElseSucceed(() => file))

const samePath = (left: string, right: string) => {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * Reads a package manifest and confirms that its `bin.kilo2` is the running executable. A manifest that exists next
 * to a similarly named package is not enough: the exact bin target has to resolve to this process.
 */
const owns = (fs: FileSystem.FileSystem, manifest: string, executable: string) =>
  Effect.gen(function* () {
    const pkg = Option.getOrUndefined(decodeManifest(yield* fs.readFileString(manifest)))
    if (pkg?.name !== packageName) return undefined
    // The v1 line shares the package name. Only the v2 channel has this version shape, and an installed manifest may
    // be newer than the still-running process after an upgrade.
    if (!isPreview(pkg.version)) return undefined
    const bin = pkg.bin?.["kilo2"]
    if (!bin) return undefined
    const target = path.resolve(path.dirname(manifest), bin)
    const real = yield* resolved(fs, target)
    if (!samePath(real, executable)) return undefined
    const info = yield* fs.stat(real)
    return info.type === "File" ? pkg : undefined
  }).pipe(Effect.orElseSucceed(() => undefined))

const output = (exec: Exec, command: string[]) =>
  exec(command).pipe(
    Effect.map((result) => (result.code === 0 ? result.stdout.trim() : "")),
    Effect.orElseSucceed(() => ""),
  )

const version = (exec: Exec, command: string[]) =>
  output(exec, command).pipe(
    Effect.map(
      (text) =>
        text
          .split(/\r?\n/)
          .find((line) => line.trim().length > 0)
          ?.trim() ?? "",
    ),
  )

// pnpm has been reported to write a warning to stdout before the path. Use the last absolute line so that a warning
// does not make a package manager look missing, and a path containing spaces still works.
const directory = (exec: Exec, command: string[]) =>
  output(exec, command).pipe(
    Effect.map((text) =>
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .findLast((line) => line.length > 0 && path.isAbsolute(line)),
    ),
  )

const target = (version: string) => `${packageName}@${version}`

const npmCommand =
  (prefix: string) =>
  (version: string): string[] => [
    "npm",
    "install",
    "--global",
    "--prefix",
    prefix,
    `--registry=${registry}`,
    `--@kilocode:registry=${registry}`,
    `--allow-scripts=${packageName}`,
    target(version),
  ]

const pnpmCommand = (version: string): string[] => [
  "pnpm",
  "add",
  "--global",
  `--registry=${registry}`,
  `--@kilocode:registry=${registry}`,
  `--allow-build=${packageName}`,
  target(version),
]

const yarnCommand =
  (prefix: string) =>
  (version: string): string[] => [
    "yarn",
    "--no-default-rc",
    "global",
    "add",
    "--prefix",
    prefix,
    "--registry",
    registry,
    target(version),
  ]

const install = (input: Omit<Install, "command">, command: Install["command"]): Install => ({
  ...input,
  command,
})

// npm installs a package under <prefix>/lib/node_modules on POSIX and <prefix>/node_modules on Windows. When the
// layout is exactly that, use the prefix that owns the running binary and pass it explicitly, so the npm on PATH
// cannot update a different prefix. Other managers use recognizable global directories, which must not be treated as
// an npm prefix if their own ownership probe does not match.
const fromNpm = (fs: FileSystem.FileSystem, exec: Exec, executable: string) =>
  Effect.gen(function* () {
    const packageDirectory = path.dirname(path.dirname(executable))
    if (path.basename(packageDirectory) !== "cli") return undefined
    if (path.basename(path.dirname(packageDirectory)) !== "@kilocode") return undefined
    const modules = path.dirname(path.dirname(packageDirectory))
    if (path.basename(modules) !== "node_modules") return undefined
    const parent = path.dirname(modules)
    const prefix =
      process.platform === "win32" ? parent : path.basename(parent) === "lib" ? path.dirname(parent) : undefined
    if (!prefix || foreign(executable)) return undefined
    if (process.platform !== "win32" && !samePath(yield* resolved(fs, path.join(prefix, "bin", "kilo2")), executable))
      return undefined
    // Verify the exact global root rather than trusting the shape alone. A project node_modules or a pnpm/Bun/Yarn
    // global directory can have the same tail. Windows has no lib component, so only npm's configured global root
    // counts there; a custom prefix that is not configured fails closed to the manual instructions.
    const root =
      process.platform === "win32"
        ? yield* directory(exec, ["npm", "root", "-g"])
        : yield* directory(exec, ["npm", "root", "-g", "--prefix", prefix])
    if (!root || !samePath(root, modules)) return undefined
    return install(
      {
        method: "npm",
        manifest: path.join(packageDirectory, "package.json"),
        scriptsSetting: ["npm", "config", "get", "ignore-scripts", "--global", "--prefix", prefix],
      },
      npmCommand(prefix),
    )
  })

const foreign = (executable: string) => {
  const parts = executable.toLowerCase().split(path.sep)
  const adjacent = (child: string, parents: string[]) =>
    parts.some((part, index) => part === child && parents.includes(parts[index - 1] ?? ""))
  return (
    parts.includes(".pnpm") ||
    parts.includes("_npx") ||
    adjacent("global", ["install", "yarn", "pnpm"]) ||
    adjacent("cache", ["install"])
  )
}

const decodeGroup = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ dependencies: Schema.Record(Schema.String, Schema.String) })),
)

// pnpm 11+ removes the whole previous group on `add -g`, including its other commands. Only a single-package
// group can be replaced this way. Registry selection is part of its hash, so resolve the group again after install.
const pnpmManifest = (fs: FileSystem.FileSystem, root: string, major: number) =>
  Effect.gen(function* () {
    if (major <= 10)
      return path.basename(root) === "node_modules" ? path.join(root, packageName, "package.json") : undefined
    if (path.basename(root) === "node_modules") return undefined
    const entries = yield* fs.readDirectoryEntries(root).pipe(Effect.orElseSucceed(() => []))
    const groups = yield* Effect.forEach(
      entries.filter((entry) => entry.type === "SymbolicLink"),
      (entry) =>
        Effect.gen(function* () {
          const directory = path.join(root, entry.name)
          const pkg = Option.getOrUndefined(decodeGroup(yield* fs.readFileString(path.join(directory, "package.json"))))
          if (!pkg || !Object.hasOwn(pkg.dependencies, packageName)) return
          return { directory, count: Object.keys(pkg.dependencies).length }
        }).pipe(Effect.orElseSucceed(() => undefined)),
    )
    const owners = groups.filter((group) => group !== undefined)
    if (owners.length !== 1 || owners[0].count !== 1) return undefined
    return path.join(owners[0].directory, "node_modules", packageName, "package.json")
  })

// pnpm 11 installs each global package group into its own directory and keeps a deterministic hash symlink that a
// later `pnpm add -g` swaps to the new install. `pnpm root -g` prints that global package directory, so the manifest
// is the hash link's package, which still resolves after an upgrade. The physical install directories are disposable
// and a stale one can still own the running executable, so they are not candidates. More than one group link that
// contains the package makes the next install target ambiguous, so that also fails closed. pnpm 10 and older keep one
// node_modules root whose package link is replaced in place.
const fromPnpm = (fs: FileSystem.FileSystem, exec: Exec, executable: string) =>
  Effect.gen(function* () {
    const manager = yield* version(exec, ["pnpm", "--version"])
    const major = Number.parseInt(manager.split(".")[0] ?? "", 10)
    if (!Number.isInteger(major) || major < 1) return undefined
    const root = yield* directory(exec, ["pnpm", "root", "-g"])
    if (!root) return undefined
    const installedManifest = pnpmManifest(fs, root, major)
    const manifest = yield* installedManifest
    if (!manifest || !(yield* owns(fs, manifest, executable))) return undefined
    return install(
      {
        method: "pnpm",
        manifest,
        installedManifest,
        scriptsSetting: ["pnpm", "config", "get", "ignore-scripts", "--global"],
      },
      pnpmCommand,
    )
  })

const fromYarn = (fs: FileSystem.FileSystem, exec: Exec, executable: string) =>
  Effect.gen(function* () {
    const manager = yield* version(exec, ["yarn", "--no-default-rc", "--version"])
    if (!manager.startsWith("1.")) return undefined
    const root = yield* directory(exec, ["yarn", "--no-default-rc", "global", "dir"])
    if (!root) return undefined
    const manifest = path.join(root, "node_modules", packageName, "package.json")
    if (!(yield* owns(fs, manifest, executable))) return undefined
    // A Yarn global directory can be paired with a separate bin prefix. Verify the link too, so Yarn cannot
    // overwrite a kilo2 link installed by npm or by the native installer when it refreshes its global commands.
    const bin = yield* directory(exec, ["yarn", "--no-default-rc", "global", "bin"])
    if (!bin || path.basename(bin) !== "bin") return undefined
    if (!samePath(yield* resolved(fs, path.join(bin, "kilo2")), executable)) return undefined
    // --no-default-rc ignores files, not npm_config_* environment settings. Yarn's --registry only sets its default.
    const scoped = yield* output(exec, ["yarn", "--no-default-rc", "config", "get", "@kilocode:registry"])
    if (scoped !== "undefined" && scoped !== registry && scoped !== `${registry}/`) return undefined
    return install(
      { method: "yarn", manifest, scriptsSetting: ["yarn", "--no-default-rc", "config", "get", "ignore-scripts"] },
      yarnCommand(path.dirname(bin)),
    )
  })

// Volta keeps packages in tools/image/packages and mise's npm backend in installs/npm-*. Both record their own
// version, so updating the copy in place would leave that record stale.
const managed = (executable: string) => {
  const parts = executable.toLowerCase().split(path.sep)
  return (
    (parts.includes("tools") && parts.includes("image") && parts.includes("packages")) ||
    parts.some((part, index) => part === "installs" && (parts[index + 1] ?? "").startsWith("npm-"))
  )
}

/**
 * Detects the global package manager that owns `executable`. Undefined means the copy is not a verified global npm,
 * pnpm or Yarn Classic install of `@kilocode/cli`, including Bun, Volta, mise, standalone and VSIX copies. Bun has no
 * reliable way to force the public registry for a scope, so its globals are left to manual updates. The caller reads
 * `manifest` and validates the installed package version before offering an update.
 */
export const detect = (fs: FileSystem.FileSystem, exec: Exec, executable: string): Effect.Effect<Install | undefined> =>
  Effect.gen(function* () {
    const running = yield* resolved(fs, executable)
    if (managed(running)) return undefined
    // Reject before probing: the running copy must sit in the published launcher layout with its exact bin target.
    if (!(yield* owns(fs, path.join(path.dirname(path.dirname(running)), "package.json"), running))) return undefined
    const npm = yield* fromNpm(fs, exec, running)
    if (npm) return npm
    const probes = yield* Effect.all([fromPnpm(fs, exec, running), fromYarn(fs, exec, running)], {
      concurrency: "unbounded",
    })
    return probes.find((probe) => probe !== undefined)
  })
