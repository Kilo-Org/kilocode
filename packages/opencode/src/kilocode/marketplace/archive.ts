import path from "node:path"
import { gunzipSync } from "node:zlib"
import matter from "gray-matter"
import { Effect } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { SkillArchiveError } from "./errors"
import { MAX_ARCHIVE_ENTRIES, MAX_ARTIFACT_BYTES, MAX_EXTRACTED_BYTES } from "./schema"

interface Entry {
  readonly path: string
  readonly type: "file" | "directory"
  readonly data: Uint8Array
}

const decoder = new TextDecoder("utf-8", { fatal: true })
const MAX_SKILL_BYTES = 1024 * 1024
const windowsName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function fail(id: string, reason: SkillArchiveError["reason"], entry?: string): never {
  throw new SkillArchiveError({ id, reason, ...(entry === undefined ? {} : { entry }) })
}

function text(bytes: Uint8Array, offset: number, length: number, id: string) {
  const field = bytes.subarray(offset, offset + length)
  const end = field.indexOf(0)
  const value = field.subarray(0, end < 0 ? field.length : end)
  return decoder.decode(value)
}

function octal(bytes: Uint8Array, offset: number, length: number, id: string) {
  const value = text(bytes, offset, length, id).trim()
  if (!/^[0-7]+$/.test(value)) return fail(id, "invalid_header")
  const parsed = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(parsed) || parsed < 0) return fail(id, "invalid_header")
  return parsed
}

function checksum(header: Uint8Array) {
  return header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0)
}

function control(value: string) {
  return /[\u0000-\u001f\u007f]/.test(value)
}

function safe(raw: string, id: string) {
  const value = raw.endsWith("/") ? raw.slice(0, -1) : raw
  if (!value || value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value)) {
    return fail(id, "unsafe_path", raw)
  }
  const parts = value.split("/")
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.includes("\\") ||
        part.includes(":") ||
        part.endsWith(".") ||
        part.endsWith(" ") ||
        windowsName.test(part) ||
        control(part),
    )
  ) {
    return fail(id, "unsafe_path", raw)
  }
  return parts.join("/")
}

function oversized(error: unknown) {
  if (error instanceof RangeError) return true
  return typeof error === "object" && error !== null && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE"
}

function parse(bytes: Uint8Array, id: string) {
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) return fail(id, "too_large")
  const body = (() => {
    try {
      return gunzipSync(bytes, { maxOutputLength: MAX_EXTRACTED_BYTES + 1 })
    } catch (error) {
      return fail(id, oversized(error) ? "too_large" : "invalid_gzip")
    }
  })()
  if (body.byteLength > MAX_EXTRACTED_BYTES) return fail(id, "too_large")

  const entries: Entry[] = []
  const names = new Set<string>()
  let offset = 0
  let total = 0
  let ended = false
  while (offset + 512 <= body.byteLength) {
    const header = body.subarray(offset, offset + 512)
    if (header.every((value) => value === 0)) {
      const next = body.subarray(offset + 512, offset + 1_024)
      if (next.byteLength !== 512 || !next.every((value) => value === 0)) return fail(id, "invalid_header")
      if (body.subarray(offset + 1_024).some((value) => value !== 0)) return fail(id, "invalid_header")
      ended = true
      break
    }
    if (!text(header, 257, 6, id).startsWith("ustar")) return fail(id, "invalid_header")
    if (octal(header, 148, 8, id) !== checksum(header)) return fail(id, "invalid_checksum")

    const name = text(header, 0, 100, id)
    const prefix = text(header, 345, 155, id)
    const entry = safe(prefix ? `${prefix}/${name}` : name, id)
    if (names.has(entry)) return fail(id, "duplicate_path", entry)
    names.add(entry)
    if (names.size > MAX_ARCHIVE_ENTRIES) return fail(id, "too_many_entries")

    const size = octal(header, 124, 12, id)
    const type = String.fromCharCode(header[156] ?? 0)
    const start = offset + 512
    const end = start + size
    if (end > body.byteLength || !Number.isSafeInteger(end)) return fail(id, "invalid_header", entry)
    if (type === "1" || type === "2") return fail(id, "link", entry)
    if (type !== "\0" && type !== "0" && type !== "5") return fail(id, "unsupported_entry", entry)
    if (type === "5" && size !== 0) return fail(id, "invalid_header", entry)
    if ((entry === "SKILL.md" || entry === `${id}/SKILL.md`) && size > MAX_SKILL_BYTES) {
      return fail(id, "too_large", entry)
    }

    total += size
    if (total > MAX_EXTRACTED_BYTES) return fail(id, "too_large")
    entries.push({
      path: entry,
      type: type === "5" ? "directory" : "file",
      data: type === "5" ? new Uint8Array() : body.subarray(start, end),
    })
    offset = start + Math.ceil(size / 512) * 512
  }
  if (!ended || !entries.length) return fail(id, "invalid_header")
  const skill = entries.find((entry) => entry.path === "SKILL.md" && entry.type === "file")
  if (skill) {
    decoder.decode(skill.data)
    return entries
  }

  const wrapped = entries.find((entry) => entry.path === `${id}/SKILL.md` && entry.type === "file")
  if (!wrapped) return entries
  if (!entries.every((entry) => entry.path === id || entry.path.startsWith(`${id}/`))) {
    return fail(id, "unsafe_path", wrapped.path)
  }
  decoder.decode(wrapped.data)
  return entries.flatMap((entry) => {
    if (entry.path === id) return []
    const next = entry.path.slice(id.length + 1)
    return [{ ...entry, path: next }]
  })
}

const verify = Effect.fnUntraced(function* (input: { readonly id: string; readonly dir: string }) {
  const fs = yield* AppFileSystem.Service
  const walk: (dir: string) => Effect.Effect<void, SkillArchiveError> = Effect.fnUntraced(function* (dir: string) {
    const entries = yield* fs
      .readDirectoryEntries(dir)
      .pipe(Effect.mapError(() => new SkillArchiveError({ id: input.id, reason: "filesystem" })))
    for (const entry of entries) {
      if (entry.type === "symlink" || entry.type === "other") {
        return yield* new SkillArchiveError({ id: input.id, reason: "link", entry: entry.name })
      }
      const next = path.join(dir, entry.name)
      if (!AppFileSystem.contains(input.dir, next)) {
        return yield* new SkillArchiveError({ id: input.id, reason: "unsafe_path", entry: entry.name })
      }
      if (entry.type === "directory") yield* walk(next)
    }
  })
  yield* walk(input.dir)

  const file = path.join(input.dir, "SKILL.md")
  if (!(yield* fs.isFile(file))) return yield* new SkillArchiveError({ id: input.id, reason: "missing_skill" })
  const raw = yield* fs
    .readFileString(file)
    .pipe(Effect.mapError(() => new SkillArchiveError({ id: input.id, reason: "filesystem" })))
  const parsed = yield* Effect.try({
    try: () => matter(raw),
    catch: () => new SkillArchiveError({ id: input.id, reason: "invalid_skill" }),
  })
  if (
    typeof parsed.data !== "object" ||
    parsed.data === null ||
    parsed.data.name !== input.id ||
    (parsed.data.description !== undefined && typeof parsed.data.description !== "string") ||
    !parsed.content.trim()
  ) {
    return yield* new SkillArchiveError({ id: input.id, reason: "invalid_skill" })
  }
})

export namespace SkillArchive {
  export const extract = Effect.fn("Marketplace.SkillArchive.extract")(function* (input: {
    readonly id: string
    readonly bytes: Uint8Array
    readonly destination: string
  }) {
    const fs = yield* AppFileSystem.Service
    const entries = yield* Effect.try({
      try: () => parse(input.bytes, input.id),
      catch: (error) =>
        error instanceof SkillArchiveError ? error : new SkillArchiveError({ id: input.id, reason: "invalid_header" }),
    })

    const destination = path.resolve(input.destination)
    yield* fs
      .makeDirectory(destination, { recursive: true, mode: 0o700 })
      .pipe(Effect.mapError(() => new SkillArchiveError({ id: input.id, reason: "filesystem" })))
    const root = yield* fs
      .realPath(destination)
      .pipe(Effect.mapError(() => new SkillArchiveError({ id: input.id, reason: "filesystem" })))
    if (root !== destination) return yield* new SkillArchiveError({ id: input.id, reason: "unsafe_path" })
    const existing = yield* fs
      .readDirectoryEntries(root)
      .pipe(Effect.mapError(() => new SkillArchiveError({ id: input.id, reason: "filesystem" })))
    if (existing.length) return yield* new SkillArchiveError({ id: input.id, reason: "filesystem" })

    for (const entry of entries) {
      const target = path.resolve(root, ...entry.path.split("/"))
      if (!AppFileSystem.contains(root, target)) {
        return yield* new SkillArchiveError({ id: input.id, reason: "unsafe_path", entry: entry.path })
      }
      if (entry.type === "directory") {
        yield* fs
          .makeDirectory(target, { recursive: true, mode: 0o700 })
          .pipe(Effect.mapError(() => new SkillArchiveError({ id: input.id, reason: "filesystem", entry: entry.path })))
        continue
      }
      yield* fs
        .makeDirectory(path.dirname(target), { recursive: true, mode: 0o700 })
        .pipe(Effect.mapError(() => new SkillArchiveError({ id: input.id, reason: "filesystem", entry: entry.path })))
      yield* fs
        .writeFile(target, entry.data, { flag: "wx", mode: 0o600 })
        .pipe(Effect.mapError(() => new SkillArchiveError({ id: input.id, reason: "filesystem", entry: entry.path })))
    }
    yield* verify({ id: input.id, dir: root })
    return { path: root, skill: path.join(root, "SKILL.md") }
  })

  export const validate = verify
}
