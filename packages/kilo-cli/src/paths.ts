import { lstatSync, realpathSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { roots } from "@opencode-ai/util/global-roots"

export const identity = "kilo2"
export const channel = "preview"

export function layout(profile: "preview" | "interactive" = channel) {
  const root = roots(identity)
  const paths = {
    home: os.homedir(),
    data: path.join(root.data, profile),
    config: path.join(root.config, profile),
    cache: path.join(root.cache, profile),
    state: path.join(root.state, profile),
    tmp: path.join(root.tmp, profile),
    bin: path.join(root.cache, profile, "bin"),
    log: path.join(root.data, profile, "log"),
    repos: path.join(root.data, profile, "repos"),
  }
  return {
    channel: profile,
    paths,
    roots: Object.values(root),
    database: path.join(paths.data, "kilo2.db"),
    config: path.join(paths.config, "kilo.jsonc"),
    tuiConfig: path.join(paths.config, "tui.json"),
    telemetryConfig: path.join(paths.config, "telemetry.json"),
    password: path.join(paths.state, "server.password"),
    pty: path.join(paths.tmp, "pty"),
  }
}

export type Layout = ReturnType<typeof layout>

export function preflight(input: Layout) {
  const home = os.homedir()
  const defaults = [
    path.join(home, ".local", "share"),
    path.join(home, ".config"),
    path.join(home, ".cache"),
    path.join(home, ".local", "state"),
    os.tmpdir(),
  ]
  const protectedPaths = [
    ...["kilo", "opencode"].flatMap((name) => [
      ...Object.values(roots(name)),
      ...defaults.map((base) => path.join(base, name)),
    ]),
    ...["KILO_DB", "KILO_CONFIG_DIR", "OPENCODE_DB", "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG"]
      .map((key) => process.env[key])
      .filter((value): value is string => !!value && path.isAbsolute(value)),
  ].map(canonical)
  const directories = [
    ...input.roots,
    ...Object.entries(input.paths).flatMap(([key, value]) => (key === "home" ? [] : [value])),
    path.join(input.paths.state, "locks"),
    input.pty,
  ]
  const files = [
    input.database,
    `${input.database}-wal`,
    `${input.database}-shm`,
    `${input.database}-journal`,
    input.config,
    input.tuiConfig,
    input.telemetryConfig,
    input.password,
  ]
  for (const filename of [...directories, ...files]) {
    if (!path.isAbsolute(filename)) throw new Error(`Preview paths must be absolute: ${filename}`)
    const resolved = canonical(filename)
    if (protectedPaths.some((other) => contains(resolved, other) || contains(other, resolved))) {
      throw new Error(`Refusing a protected Kilo/OpenCode path: ${filename}`)
    }
    const stat = lstatSync(filename, { throwIfNoEntry: false })
    if (!stat) continue
    if (stat.isSymbolicLink()) throw new Error(`Refusing a symlink in preview storage: ${filename}`)
    if (directories.includes(filename)) {
      if (!stat.isDirectory()) throw new Error(`Preview directory is not a directory: ${filename}`)
      continue
    }
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error(`Refusing a shared or non-regular preview file: ${filename}`)
  }
  for (const name of ["auth.json", "opencode-next.db"]) {
    if (lstatSync(path.join(input.paths.data, name), { throwIfNoEntry: false })) {
      throw new Error(`Legacy import source found in preview storage: ${name}; automatic import is disabled`)
    }
  }
}

function canonical(filename: string): string {
  if (lstatSync(filename, { throwIfNoEntry: false })) return realpathSync(filename)
  const parent = path.dirname(filename)
  if (parent === filename) throw new Error(`Cannot resolve preview path: ${filename}`)
  return path.join(canonical(parent), path.basename(filename))
}

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}
