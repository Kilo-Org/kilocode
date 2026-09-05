export * as TelemetrySettings from "./telemetry-settings.js"

import { Option, Schema } from "effect"
import { randomUUID } from "node:crypto"
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { resolveConfig, type TelemetryConfig } from "./telemetry"

// Isolated persisted consent for the activity exporter. This file is separate
// from kilo.jsonc on purpose: upstream config schema rejects telemetry keys
// (unsupportedExperimental), and consent must not be expressible through
// shared upstream config. Default is OFF; only an explicit persisted
// enabled: true opts in. The file may carry credential-bearing headers, so it
// must stay owner-private (0600) and must never be adopted through another
// inode (symlink, hardlink, or non-regular file).
const SettingsSchema = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Boolean,
  endpoint: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.String),
  client: Schema.optional(Schema.String),
  channel: Schema.optional(Schema.String),
})

export type Settings = Schema.Schema.Type<typeof SettingsSchema>

export const disabled: Settings = { version: 1, enabled: false }

const decode = Schema.decodeUnknownOption(SettingsSchema)
const decodeText = Schema.decodeUnknownOption(Schema.fromJsonString(SettingsSchema))

// A consent file is a handful of bytes; anything larger is not a consent file.
const READ_LIMIT = 64 * 1024

export async function read(file: string): Promise<Settings> {
  const text = readBounded(file)
  if (text === undefined) return disabled
  const decoded = decodeText(text)
  if (Option.isNone(decoded)) return disabled
  return decoded.value
}

// Presence-aware consent resolution for host/CLI wiring. A missing consent
// file defers entirely to the environment (so an explicit env opt-in keeps
// working before any consent was ever persisted), while any present file —
// enabled, declined, rejected, or corrupt — decides consent itself and a
// declined/rejected/corrupt one forces OFF over the environment.
export async function resolve(file: string, env: NodeJS.ProcessEnv = process.env): Promise<TelemetryConfig> {
  try {
    if (!lstatSync(file, { throwIfNoEntry: false })) return resolveConfig(undefined, env)
    return resolveConfig(input(await read(file)), env)
  } catch {
    return resolveConfig({ enabled: false }, env)
  }
}

// Fail closed: absent, unreadable, symlinked, hardlinked, non-regular,
// public-readable, oversized, corrupt, or schema-invalid files all read as
// disabled and never throw or hang.
function readBounded(file: string): string | undefined {
  let fd: number | undefined
  try {
    const stat = lstatSync(file, { throwIfNoEntry: false })
    if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) return undefined
    if ((stat.mode & 0o077) !== 0 || stat.size > READ_LIMIT) return undefined
    // O_NONBLOCK so a path swapped to a FIFO between lstat and open cannot
    // block the host on open or read.
    fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK)
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.nlink !== 1 || (opened.mode & 0o077) !== 0) return undefined
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > READ_LIMIT) return undefined
    const chunks: Buffer[] = []
    let total = 0
    const buffer = Buffer.allocUnsafe(4096)
    while (total < READ_LIMIT) {
      const bytes = readSync(fd, buffer, 0, Math.min(buffer.length, READ_LIMIT - total), null)
      if (bytes === 0) break
      chunks.push(Buffer.from(buffer.subarray(0, bytes)))
      total += bytes
    }
    if (readSync(fd, buffer, 0, 1, null) !== 0) return undefined
    return Buffer.concat(chunks).toString("utf8")
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function rejectForeign(file: string): void {
  const existing = lstatSync(file, { throwIfNoEntry: false })
  if (existing && (existing.isSymbolicLink() || !existing.isFile() || existing.nlink !== 1)) {
    throw new Error(`Refusing to replace non-regular telemetry settings: ${file}`)
  }
}

export async function write(file: string, settings: Settings): Promise<void> {
  const decoded = decode(settings)
  if (Option.isNone(decoded)) throw new Error(`Invalid telemetry settings: ${file}`)
  rejectForeign(file)
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(decoded.value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })
    rejectForeign(file)
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
}

// Bridge from persisted consent to the exporter config boundary. resolveConfig
// keeps single ownership of endpoint validation and the explicit-false-wins
// consent precedence, so this mapping stays field-for-field.
export function input(settings: Settings): Partial<TelemetryConfig> {
  return {
    enabled: settings.enabled,
    endpoint: settings.endpoint,
    headers: settings.headers,
    client: settings.client,
    channel: settings.channel,
  }
}
