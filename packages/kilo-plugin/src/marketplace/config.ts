export * as MarketplaceConfig from "./config"

import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

// A native config that cannot be read or written safely: unparsable JSON, or a project target that resolves
// outside the locations the scope may write.
export class ConfigError extends Error {
  constructor(
    readonly reason: "invalid_params" | "conflict",
    message: string,
  ) {
    super(message)
  }
}

export async function configFile(directory: string, global: boolean) {
  const checked = async (file: string) => {
    if (global) return file
    const target = await resolveFile(file)
    // Repository-controlled symlinks cannot authorize writes outside the project's native config locations.
    if (!(await nativeTarget(directory, target)))
      throw new ConfigError("conflict", `Project config resolves outside its native config locations: ${file}`)
    return file
  }
  for (const candidate of KiloConfigFiles.writeCandidates(directory, global)) {
    if (
      await fs.stat(candidate).then(
        (info) => info.isFile(),
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false
          throw error
        },
      )
    )
      return checked(candidate)
  }
  return checked(path.join(directory, KiloConfigFiles.newFile))
}

/** Whether a canonical target is one of the project's native config files. */
export async function nativeTarget(directory: string, target: string) {
  return KiloConfigFiles.writeCandidates(await resolveFile(directory), false).includes(target)
}

// Canonical aliases share one atomic read-modify-write queue across every marketplace config writer. Other
// processes are not covered.
const queues = new Map<string, Promise<unknown>>()
export async function serialized<A>(file: string, task: (file: string) => Promise<A>) {
  const target = await resolveFile(path.resolve(file))
  const run = (queues.get(target) ?? Promise.resolve()).catch(() => undefined).then(() => task(target))
  queues.set(target, run)
  return run.finally(() => {
    if (queues.get(target) === run) queues.delete(target)
  })
}

export async function resolveFile(file: string): Promise<string> {
  return fs.realpath(file).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
    const info = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (info?.isSymbolicLink())
      return resolveFile(path.resolve(await resolveFile(path.dirname(file)), await fs.readlink(file)))
    if (info) return fs.realpath(file)
    return path.join(await resolveFile(path.dirname(file)), path.basename(file))
  })
}

export async function read(file: string) {
  return fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}"
    throw error
  })
}

export function parseConfig(text: string, file: string): unknown {
  const errors: ParseError[] = []
  const data = parse(text, errors, { allowTrailingComma: true })
  if (errors.length > 0) throw new ConfigError("invalid_params", `${file} is not valid JSON; fix it first`)
  return data
}

// Preserve JSONC comments and formatting by editing only the target node.
export function edit(text: string, key: (string | number)[], value: unknown, insertion = false) {
  return applyEdits(
    text,
    modify(text, key, value, { formattingOptions: { tabSize: 2, insertSpaces: true }, isArrayInsertion: insertion }),
  )
}

export function save(file: string, text: string, key: (string | number)[], value: unknown, secret = false) {
  return write(file, edit(text, key, value), secret)
}

// Replace the target atomically for native config watchers.
export async function write(file: string, text: string, secret = false) {
  const mode = await fs.stat(file).then(
    (info) => (secret ? 0o600 : info.mode & 0o7777),
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return 0o600
      throw error
    },
  )
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, text, { mode: 0o600, flag: "wx" })
    await fs.chmod(temporary, mode)
    await fs.rename(temporary, file)
  } catch (error) {
    const cleanup = await Promise.allSettled([fs.rm(temporary, { force: true })])
    if (cleanup[0].status === "rejected") {
      throw new AggregateError([error, cleanup[0].reason], `Config write and temporary cleanup failed at ${file}`, {
        cause: error,
      })
    }
    throw error
  }
}

/** A stable hash of a config value, independent of object key order. */
export function fingerprintValue(value: unknown): string {
  function normalized(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalized)
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .toSorted(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, normalized(value)]),
      )
    }
    return value
  }
  return createHash("sha256")
    .update(JSON.stringify(normalized(value)))
    .digest("hex")
}
