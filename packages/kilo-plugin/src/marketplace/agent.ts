export * as Agent from "./agent"

import type { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Skill } from "./skill"

// Agents install as one native markdown document, so the config agent plugin discovers them like any hand-written
// agent. Everything else (ownership, conflicts, recovery) lives in the shared Installer.
export class AgentError extends Error {
  constructor(
    readonly reason: "conflict" | "invalid",
    message: string,
  ) {
    super(message)
  }
}

// The document is `<id>.md` and the loader strips that suffix from the file name, so an id ending in a dot
// would install under a different agent name than the one the record owns.
export function safe(id: string) {
  return Skill.safe(id) && !id.endsWith(".")
}

/** The agent document name is the agent id, exactly as the config agent plugin derives it from the file name. */
export function target(root: string, id: string) {
  if (!safe(id)) throw new AgentError("invalid", `Invalid agent id: ${id}`)
  return path.join(root, `${id}.md`)
}

/**
 * Render a native agent document: the frontmatter keys the loader understands and the system prompt as the body.
 * The body carries the prompt because the loader reads the markdown body as an agent's system prompt.
 */
export function render(content: KiloMarketplaceRpc.AgentContent) {
  const { system, ...front } = content
  const yaml = Object.fromEntries(
    Object.entries({ ...front, model: model(front.model) }).filter(([, value]) => value !== undefined),
  )
  const header = Bun.YAML.stringify(yaml).trimEnd()
  const prompt = system?.trim() ?? ""
  return header ? `---\n${header}\n---\n\n${prompt}\n` : `---\n---\n\n${prompt}\n`
}

// A model selection decodes to its explicit form, which is also what the agent frontmatter stores.
function model(selection: NonNullable<KiloMarketplaceRpc.AgentContent["model"]> | undefined) {
  if (selection === undefined) return undefined
  return { providerID: selection.providerID, model: selection.model, ...(selection.variant ? { variant: selection.variant } : {}) }
}

export async function prepare(input: { root: string; id: string; content: KiloMarketplaceRpc.AgentContent }) {
  const file = target(input.root, input.id)
  const data = new TextEncoder().encode(render(input.content))
  return { target: file, data, fingerprint: createHash("sha256").update(data).digest("hex") }
}

export async function preflight(file: string, fingerprints: readonly string[] = []) {
  const current = await fingerprint(file)
  if (current !== undefined && !fingerprints.includes(current)) {
    throw new AgentError("conflict", `Agent at ${file} is modified or not owned by this install`)
  }
  return current
}

// Cleanup must not delete another operation's live rollback backup. Aliases share a process-local queue.
const queues = new Map<string, Promise<unknown>>()
async function serialized<A>(file: string, task: (file: string) => Promise<A>) {
  const absolute = path.resolve(file)
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

/** Stage beside the target so the promotion is one rename; the previous owned file is retained until it succeeds. */
export async function write(prepared: Awaited<ReturnType<typeof prepare>>, fingerprints: readonly string[] = []) {
  return serialized(prepared.target, async (file) => {
    await preflight(file, fingerprints)
    const failures: unknown[] = []
    const staging = path.join(path.dirname(path.dirname(file)), ".marketplace-staging", randomUUID())
    const temporary = path.join(staging, path.basename(file))
    try {
      await fs.mkdir(staging, { recursive: true })
      await fs.writeFile(temporary, prepared.data)
      await fs.mkdir(path.dirname(file), { recursive: true })
      const current = await preflight(file, fingerprints)
      await cleanup(file, fingerprints)
      const backup = current === undefined ? undefined : trash(file, current)
      if (backup) {
        await fs.mkdir(path.dirname(backup), { recursive: true })
        await fs.rename(file, backup)
      }
      try {
        await fs.rename(temporary, file)
      } catch (error) {
        if (backup) await fs.rename(backup, file).catch((error: unknown) => failures.push(error))
        throw error
      }
      if (backup) await fs.rm(backup, { force: true })
    } catch (error) {
      failures.unshift(error)
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
      await fs.rmdir(path.dirname(staging)).catch(() => undefined)
    }
    if (failures.length > 1)
      throw new AggregateError(failures, `Agent write or cleanup failed at ${file}`, { cause: failures[0] })
    if (failures.length) throw failures[0]
    return file
  })
}

export async function remove(file: string, fingerprints: readonly string[] = []) {
  return serialized(file, async (file) => {
    const current = await preflight(file, fingerprints)
    await cleanup(file, fingerprints)
    if (current === undefined) return
    const destination = trash(file, current)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.rename(file, destination)
    await fs.rm(destination, { force: true })
    await fs.rmdir(path.dirname(file)).catch(() => undefined)
  })
}

function trash(file: string, fingerprint: string) {
  const parent = path.join(path.dirname(path.dirname(file)), ".marketplace-trash")
  return path.join(
    parent,
    createHash("sha256")
      .update(JSON.stringify([path.relative(path.dirname(parent), file), fingerprint]))
      .digest("hex"),
  )
}

async function cleanup(file: string, fingerprints: readonly string[]) {
  const results = await Promise.allSettled(
    [...new Set(fingerprints)].map((fingerprint) => fs.rm(trash(file, fingerprint), { force: true })),
  )
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
  if (errors.length) throw new AggregateError(errors, `Agent trash cleanup failed at ${file}`, { cause: errors[0] })
}

export async function fingerprint(file: string): Promise<string | undefined> {
  const info = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (!info) return undefined
  if (!info.isFile() || info.isSymbolicLink()) throw new AgentError("conflict", `Unsafe agent document at ${file}`)
  return createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex")
}
