export * as Skill from "./skill"

import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

// Skill files install in a directory already scanned and watched by the native skill plugin.
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

// Cleanup must not delete another operation's live rollback backup. Aliases share a process-local queue.
const queues = new Map<string, Promise<unknown>>()
async function serialized<A>(target: string, task: (target: string) => Promise<A>) {
  const absolute = path.resolve(target)
  const canonical = path.join(await resolveDirectory(path.dirname(absolute)), path.basename(absolute))
  const run = (queues.get(canonical) ?? Promise.resolve()).catch(() => undefined).then(() => task(canonical))
  queues.set(canonical, run)
  return run.finally(() => {
    if (queues.get(canonical) === run) queues.delete(canonical)
  })
}

async function resolveDirectory(directory: string): Promise<string> {
  return fs.realpath(directory).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
    return path.join(await resolveDirectory(path.dirname(directory)), path.basename(directory))
  })
}

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

/** Stage outside the scanned directory, retaining an owned rollback tree until promotion succeeds. */
export async function write(prepared: Awaited<ReturnType<typeof prepare>>, fingerprints: readonly string[] = []) {
  return serialized(prepared.target, async (target) => {
    await preflight(target, fingerprints)
    const root = path.dirname(target)
    const staging = path.join(path.dirname(root), ".marketplace-staging", randomUUID())
    const failures: unknown[] = []
    try {
      const writes = await Promise.allSettled(
        prepared.files.map(async (file) => {
          const destination = path.join(staging, file.path)
          await fs.mkdir(path.dirname(destination), { recursive: true })
          await fs.writeFile(destination, file.data)
        }),
      )
      const failed = writes.find((write) => write.status === "rejected")
      if (failed) throw failed.reason
      await fs.mkdir(root, { recursive: true })
      const current = await preflight(target, fingerprints)
      await cleanup(target, fingerprints)
      const backup = current === undefined ? undefined : trash(target, current)
      if (backup) {
        await fs.mkdir(path.dirname(backup), { recursive: true })
        await fs.rename(target, backup)
      }
      try {
        await fs.rename(staging, target)
      } catch (error) {
        if (backup) await fs.rename(backup, target).catch((error: unknown) => failures.push(error))
        throw error
      }
      if (backup) await fs.rm(backup, { recursive: true, force: true })
    } catch (error) {
      failures.unshift(error)
    } finally {
      // All writers settled before cleanup, so none can recreate a failed staging directory.
      await fs.rm(staging, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
      await fs.rmdir(path.dirname(staging)).catch(() => undefined)
    }
    if (failures.length > 1)
      throw new AggregateError(failures, `Skill write or cleanup failed at ${target}`, { cause: failures[0] })
    if (failures.length) throw failures[0]
    return prepared.target
  })
}

/** Fingerprint-addressed trash stays locatable after interruption or a project move. */
export async function remove(target: string, fingerprints: readonly string[] = []) {
  return serialized(target, async (target) => {
    const current = await preflight(target, fingerprints)
    await cleanup(target, fingerprints)
    if (current === undefined) return
    const destination = trash(target, current)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.rename(target, destination)
    await fs.rm(destination, { recursive: true, force: true })
    // Keep the shared parent: another resource may be between mkdir and rename.
  })
}

function trash(target: string, fingerprint: string) {
  const parent = path.join(path.dirname(path.dirname(target)), ".marketplace-trash")
  return path.join(
    parent,
    createHash("sha256")
      .update(JSON.stringify([path.relative(path.dirname(parent), target), fingerprint]))
      .digest("hex"),
  )
}

async function cleanup(target: string, fingerprints: readonly string[]) {
  const results = await Promise.allSettled(
    [...new Set(fingerprints)].map((fingerprint) =>
      fs.rm(trash(target, fingerprint), { recursive: true, force: true }),
    ),
  )
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
  if (errors.length) throw new AggregateError(errors, `Skill trash cleanup failed at ${target}`, { cause: errors[0] })
}

/** Read a tar/gzip skill archive, optionally selecting one skill from a repository archive. */
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
