import { randomUUID } from "node:crypto"
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

/**
 * Extracts a skill archive into `<root>/<id>`. The files are written to a staging directory next to `root` (outside
 * the scanned directory, on the same filesystem) and moved into place in one rename, so the skill scanner never sees
 * a half-written skill. `replace` allows overwriting an existing directory, which the caller only sets for a
 * directory it installed itself.
 */
export async function install(input: {
  root: string
  id: string
  archive: Uint8Array
  replace: boolean
  select?: string
}) {
  if (!ID.test(input.id)) throw new SkillError("invalid", `Invalid skill id: ${input.id}`)
  const target = path.join(input.root, input.id)
  if (!input.replace && (await exists(target))) {
    throw new SkillError("conflict", `A skill directory already exists at ${target}`)
  }
  const files = await extract(input.archive, input.select)
  const staging = path.join(path.dirname(input.root), ".marketplace-staging", randomUUID())
  try {
    const writes = await Promise.allSettled(
      files.map(async (file) => {
        const destination = path.join(staging, file.path)
        await fs.mkdir(path.dirname(destination), { recursive: true })
        await Bun.write(destination, file.data)
      }),
    )
    const failed = writes.find((write) => write.status === "rejected")
    if (failed) throw failed.reason
    await fs.mkdir(input.root, { recursive: true })
    if (input.replace) await remove(target)
    await fs.rename(staging, target)
    return target
  } finally {
    // All writers have settled before cleanup, so none can recreate a failed staging directory.
    await fs.rm(staging, { recursive: true, force: true })
    // Concurrent installs may still use the staging parent.
    await fs.rmdir(path.dirname(staging)).catch(() => undefined)
  }
}

/**
 * Removes an installed skill directory. Keep the recorded path until deletion finishes: moving it into random trash
 * would lose ownership if recursive deletion failed. A directory that is already gone is not an error.
 */
export async function remove(target: string) {
  await fs.rm(target, { recursive: true, force: true })
}

/**
 * Reads a `.tar` or `.tar.gz` skill archive. The skill may sit at the archive root or below one top-level directory
 * (the Kilo marketplace packs `<id>/SKILL.md`). With `select`, the archive is a whole repository and the skill is the
 * shallowest directory of that name holding a `SKILL.md` (a GitHub tarball of a skills repository). Only the
 * selected files are written, so the checks apply to them: no absolute paths or `..` segments, no paths that differ
 * only in case, and a `SKILL.md` at the skill root.
 */
export async function extract(archive: Uint8Array, select?: string) {
  const entries = [...(await new Bun.Archive(archive).files()).entries()].map(([name, file]) => ({
    name: name.replaceAll("\\", "/").replace(/^\.\//, ""),
    file,
  }))
  const prefix = select ? selected(entries, select) : root(entries)
  const chosen = entries.filter((entry) => entry.name.startsWith(prefix) && entry.name.length > prefix.length)
  const unsafe = chosen.find((entry) => entry.name.startsWith("/") || entry.name.split("/").includes(".."))
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

async function exists(target: string) {
  return fs.stat(target).then(
    () => true,
    () => false,
  )
}
