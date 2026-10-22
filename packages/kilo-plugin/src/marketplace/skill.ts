export * as Skill from "./skill"

import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

// Skill files on disk. A skill installs as `<root>/<id>/SKILL.md` (plus its resources), where `<root>` is a `skills`
// directory that the native skill plugin already scans and watches, so no transform is needed.

export class SkillError extends Error {
  constructor(
    readonly reason: "conflict" | "invalid",
    message: string,
  ) {
    super(message)
  }
}

const ID = /^[a-z0-9][a-z0-9._-]*$/i
const MAX_BYTES = 32 * 1024 * 1024
const MAX_ENTRIES = 4096

export async function prepare(input: { root: string; id: string; archive: Uint8Array; select?: string }) {
  if (!ID.test(input.id)) throw new SkillError("invalid", `Invalid skill id: ${input.id}`)
  const files = await extract(input.archive, input.select)
  const { SkillFile } = await import("@opencode/core/config/plugin/skill-file")
  const parsed = SkillFile.parse(
    input.root,
    path.resolve(input.root, input.id, "SKILL.md"),
    new TextDecoder().decode(files.find((file) => file.path === "SKILL.md")!.data),
  )
  if (parsed._tag === "Skipped") throw new SkillError("invalid", `Invalid skill ${input.id}: ${parsed.reason}`)
  return { target: path.join(input.root, input.id), files, fingerprint: filesFingerprint(files) }
}

export async function preflight(target: string, fingerprints: readonly string[] = []) {
  const current = await fingerprint(target)
  if (current !== undefined && !fingerprints.includes(current)) {
    throw new SkillError("conflict", `Skill contents at ${target} are modified or not owned by this install`)
  }
  return current
}

/**
 * Writes a prepared skill into `<root>/<id>`. The files are written to a staging directory next to `root` (outside
 * the scanned directory, on the same filesystem) and moved into place in one rename, so the skill scanner never sees
 * a half-written skill. Replacing an existing directory requires a matching content fingerprint.
 */
export async function write(prepared: Awaited<ReturnType<typeof prepare>>, fingerprints: readonly string[] = []) {
  const target = prepared.target
  await preflight(target, fingerprints)
  const root = path.dirname(target)
  const staging = path.join(path.dirname(root), ".marketplace-staging", randomUUID())
  const failures: unknown[] = []
  try {
    const writes = await Promise.allSettled(
      prepared.files.map(async (file) => {
        const destination = path.join(staging, file.path)
        await fs.mkdir(path.dirname(destination), { recursive: true })
        await Bun.write(destination, file.data)
      }),
    )
    const failed = writes.find((write) => write.status === "rejected")
    if (failed) throw failed.reason
    await fs.mkdir(root, { recursive: true })
    await remove(target, fingerprints)
    await fs.rename(staging, target)
  } catch (error) {
    failures.push(error)
  } finally {
    // All writers have settled before cleanup, so none can recreate a failed staging directory.
    await fs.rm(staging, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    // Concurrent installs may still use the staging parent.
    await fs.rmdir(path.dirname(staging)).catch(() => undefined)
  }
  if (failures.length > 1)
    throw new AggregateError(failures, `Skill write and staging cleanup failed at ${target}`, { cause: failures[0] })
  if (failures.length) throw failures[0]
  return target
}

/**
 * Move an owned tree out of the scanned directory before recursive deletion. Fingerprint-addressed trash remains
 * locatable from the durable resource after interruption, even when deletion changes the tree's fingerprint.
 */
export async function remove(target: string, fingerprints: readonly string[] = []) {
  const current = await preflight(target, fingerprints)
  const parent = path.join(path.dirname(path.dirname(target)), ".marketplace-trash")
  const destination = (fingerprint: string) =>
    path.join(
      parent,
      createHash("sha256")
        // Relative identity keeps interrupted cleanup addressable when its project directory moves.
        .update(JSON.stringify([path.relative(path.dirname(parent), target), fingerprint]))
        .digest("hex"),
    )
  try {
    const cleanup = await Promise.allSettled(
      [...new Set(fingerprints)].map((fingerprint) =>
        fs.rm(destination(fingerprint), { recursive: true, force: true }),
      ),
    )
    const errors = cleanup.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
    if (errors.length) throw new AggregateError(errors, `Skill trash cleanup failed at ${target}`, { cause: errors[0] })
    if (current === undefined) return
    await fs.mkdir(parent, { recursive: true })
    await fs.rename(target, destination(current))
    await fs.rm(destination(current), { recursive: true, force: true })
  } finally {
    // Other resources may still have recoverable trash in this scope.
    await fs.rmdir(parent).catch(() => undefined)
  }
}

/**
 * Reads a `.tar` or `.tar.gz` skill archive. The skill may sit at the archive root or below one top-level directory
 * (the Kilo marketplace packs `<id>/SKILL.md`). With `select`, the archive is a whole repository and the skill is the
 * shallowest directory of that name holding a `SKILL.md` (a GitHub tarball of a skills repository). Only the
 * selected files are written, so the checks apply to them: no absolute paths or `..` segments, no paths that differ
 * only in case, and a `SKILL.md` at the skill root.
 */
export async function extract(archive: Uint8Array, select?: string) {
  if (archive.byteLength > MAX_BYTES) throw new SkillError("invalid", "Skill archive exceeds the byte limit")
  // Bound gzip expansion before Bun.Archive eagerly indexes the tar contents.
  const tar =
    archive[0] === 0x1f && archive[1] === 0x8b
      ? await bounded(
          new Blob([new Uint8Array(archive)]).stream().pipeThrough(new DecompressionStream("gzip")),
          MAX_BYTES * 2,
        )
      : archive
  const entries = [...(await new Bun.Archive(tar).files()).entries()].map(([name, file]) => ({
    name: name.replaceAll("\\", "/").replace(/^\.\//, ""),
    file,
  }))
  if (entries.length > MAX_ENTRIES) throw new SkillError("invalid", "Skill archive has too many entries")
  if (entries.reduce((size, entry) => size + entry.file.size, 0) > MAX_BYTES) {
    throw new SkillError("invalid", "Skill archive exceeds the extracted byte limit")
  }
  const prefix = select ? selected(entries, select) : root(entries)
  const chosen = entries.filter((entry) => entry.name.startsWith(prefix) && entry.name.length > prefix.length)
  const unsafe = chosen.find(
    (entry) =>
      entry.name.startsWith("/") || entry.name.split("/").some((part) => part === ".." || part === "." || part === ""),
  )
  if (unsafe) throw new SkillError("invalid", `Archive contains an unsafe path: ${unsafe.name}`)
  // Paths that differ only in case collide on case-insensitive filesystems (v1 rejected them too).
  if (new Set(chosen.map((entry) => entry.name.toLowerCase())).size !== chosen.length) {
    throw new SkillError("invalid", "Archive contains duplicate paths")
  }
  const files = await Promise.all(
    chosen.map(async (entry) => ({
      path: entry.name.slice(prefix.length),
      data: new Uint8Array(await entry.file.arrayBuffer()),
    })),
  )
  if (!files.some((file) => file.path === "SKILL.md")) {
    throw new SkillError("invalid", "Archive has no SKILL.md at the skill root")
  }
  return files
}

function root(entries: readonly { name: string }[]) {
  const tops = new Set(entries.map((entry) => entry.name.split("/")[0]))
  return tops.size === 1 && !entries.some((entry) => entry.name === "SKILL.md") ? `${[...tops][0]}/` : ""
}

function selected(entries: readonly { name: string }[], name: string) {
  const match = entries
    .map((entry) => entry.name)
    .filter((path) => path.endsWith(`/${name}/SKILL.md`) || path === `${name}/SKILL.md`)
    .toSorted((a, b) => a.split("/").length - b.split("/").length)[0]
  if (!match) throw new SkillError("invalid", `The archive has no skill named ${name}`)
  return match.slice(0, -"SKILL.md".length)
}

export async function bounded(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > limit) throw new SkillError("invalid", "Archive exceeds the byte limit")
      chunks.push(next.value)
    }
    return new Uint8Array(Buffer.concat(chunks, size))
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function filesFingerprint(files: readonly { path: string; data: Uint8Array }[]) {
  const entries = new Map<string, string>()
  for (const file of files) {
    const parts = file.path.split("/")
    for (let depth = 1; depth < parts.length; depth++) entries.set(parts.slice(0, depth).join("/"), "directory")
    entries.set(file.path, createHash("sha256").update(file.data).digest("hex"))
  }
  return treeHash(entries)
}

function treeHash(entries: ReadonlyMap<string, string>) {
  return createHash("sha256")
    .update(JSON.stringify([...entries].toSorted(([a], [b]) => a.localeCompare(b))))
    .digest("hex")
}

export async function fingerprint(target: string): Promise<string | undefined> {
  const info = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (!info) return undefined
  if (!info.isDirectory() || info.isSymbolicLink()) throw new SkillError("conflict", `Unsafe skill tree at ${target}`)
  const entries = new Map<string, string>()
  async function visit(directory: string) {
    for (const child of await fs.readdir(directory, { withFileTypes: true })) {
      const location = path.join(directory, child.name)
      const relative = path.relative(target, location).split(path.sep).join("/")
      if (child.isDirectory()) {
        entries.set(relative, "directory")
        await visit(location)
        continue
      }
      if (!child.isFile()) throw new SkillError("conflict", `Unsafe skill tree at ${target}`)
      entries.set(
        relative,
        createHash("sha256")
          .update(await fs.readFile(location))
          .digest("hex"),
      )
    }
  }
  await visit(target)
  return treeHash(entries)
}
