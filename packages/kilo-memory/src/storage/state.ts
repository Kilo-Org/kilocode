import { readdir, rm } from "fs/promises"
import path from "path"
import { MemoryAudit } from "./audit"
import { MemoryFs } from "./fs"
import { MemoryMarkdown } from "./markdown"
import { MemoryPaths } from "./paths"
import { MemorySchema } from "../schema"
import { MemorySources } from "./sources"
import { MemoryText } from "../text"
import { MemoryTopics } from "../recall/topics"

export namespace MemoryState {
  const seed: Record<MemorySchema.Source, string> = {
    "project.md": "# Project Memory\n\n## Facts\n\n## Decisions\n\n## Constraints\n\n## Open Questions\n",
    "environment.md": "# Environment Memory\n\n## Commands\n\n## Paths\n\n## Tooling\n",
    "corrections.md": "# Corrective Memory\n\n## Corrections\n",
  }

  async function recover(root: string, file: string, error: unknown) {
    await MemoryFs.backup(file)
    const state = MemorySchema.missing()
    await writeState(root, state)
    await MemoryAudit.append(root, `recover state.json error=${MemoryFs.brief(error)}`).catch((err: unknown) =>
      MemoryFs.warn("failed to audit memory state recovery", { err, root }),
    )
    return state
  }

  export async function readState(root: string) {
    const file = MemoryPaths.files(root).state
    const data = await MemoryFs.json(file).catch(async (error: unknown) => {
      if (MemoryFs.miss(error)) return undefined
      if (MemoryFs.parse(error)) return recover(root, file, error)
      throw error
    })
    if (data === undefined) return MemorySchema.missing()
    return Promise.resolve()
      .then(() => MemorySchema.parse(data))
      .catch((error: unknown) => {
        if (MemoryFs.parse(error)) return recover(root, file, error)
        throw error
      })
  }

  export async function writeState(root: string, state: MemorySchema.State) {
    await MemoryFs.write(MemoryPaths.files(root).state, `${JSON.stringify(MemorySchema.persist(state), null, 2)}\n`)
  }

  export async function writeManifest(root: string, id?: MemoryPaths.Identity) {
    const file = MemoryPaths.files(root).manifest
    const prior = await MemoryFs.json(file).catch((error: unknown) => {
      if (MemoryFs.miss(error)) return undefined
      throw error
    })
    const createdAt =
      typeof prior === "object" && prior !== null && "createdAt" in prior && typeof prior.createdAt === "string"
        ? prior.createdAt
        : new Date().toISOString()
    await MemoryFs.write(
      file,
      `${JSON.stringify(
        {
          kind: "kilo-memory",
          version: 1,
          ...(id
            ? {
                display: id.display,
                canonical: id.canonical,
                folder: id.folder,
              }
            : {}),
          createdAt,
        },
        null,
        2,
      )}\n`,
    )
  }

  export async function owned(root: string) {
    const data = await MemoryFs.json(MemoryPaths.files(root).manifest).catch((error: unknown) => {
      if (MemoryFs.miss(error)) return undefined
      throw error
    })
    return (
      typeof data === "object" &&
      data !== null &&
      "kind" in data &&
      data.kind === "kilo-memory" &&
      "version" in data &&
      data.version === 1
    )
  }

  export async function readIndex(root: string) {
    const file = MemoryPaths.files(root).index
    return MemoryFs.read(file)
      .then((text) => text ?? "")
      .catch((error: unknown) => {
        if (MemoryFs.miss(error)) return ""
        throw error
      })
  }

  export async function writeIndex(root: string, text: string) {
    await MemoryFs.write(MemoryPaths.files(root).index, text)
  }

  export async function indexExpired(root: string) {
    const paths = MemoryPaths.files(root)
    const index = await MemoryFs.guard(paths.index)
    if (!index) return true
    if (!index.isFile()) throw new Error(`memory path is not a file: ${paths.index}`)
    const stamp = await MemoryFs.mtimeNs(paths.index)
    const files = await readdir(paths.sessions).catch((error: unknown) => {
      if (MemoryFs.miss(error)) return [] as string[]
      throw error
    })
    const digests = files
      .filter((file) => file.endsWith(".md"))
      .sort()
      .reverse()
    const sources = [
      paths.project,
      paths.environment,
      paths.corrections,
      ...digests.map((file) => path.join(paths.sessions, file)),
    ]
    const times = await Promise.all(sources.map((file) => MemoryFs.mtimeNs(file)))
    if (times.slice(0, MemorySchema.Sources.length).some((time) => time === 0n)) return true
    const content = (await MemoryFs.read(paths.index)) ?? ""
    const indexed = new Set([...content.matchAll(/^text: session=([^\s]+)/gm)].map((match) => match[1]))
    const current = await Promise.all(
      digests.map(async (file) => {
        const text = await MemoryFs.read(path.join(paths.sessions, file))
        if (!text) return
        const lines = text.split("\n")
        const at = lines.findIndex((line) => line.trim() === "## Summary")
        if (at < 0 || !lines.slice(at + 1).some((line) => line.trim())) return
        return text.match(/^# Session (.+)$/m)?.[1]?.trim()
      }),
    )
    const ids = new Set(current.filter((id): id is string => Boolean(id)))
    if ([...indexed].some((id) => !ids.has(id))) return true
    const latest = current.find((id): id is string => Boolean(id))
    if (latest && !indexed.has(latest)) return true
    const sessions = await MemoryFs.guard(paths.sessions)
    if (sessions && !sessions.isDirectory()) throw new Error(`memory path is not a directory: ${paths.sessions}`)
    const changed = await MemoryFs.mtimeNs(paths.sessions)
    return times.some((time) => time > stamp) || changed > stamp
  }

  export async function scaffold(root: string, id?: MemoryPaths.Identity) {
    const paths = MemoryPaths.files(root)
    await MemoryFs.dir(root)
    await MemoryFs.dir(paths.sessions)
    await MemoryFs.ensure(paths.ignore, "*\n!.gitignore\n")
    await MemoryFs.ensure(paths.project, seed["project.md"])
    await MemoryFs.ensure(paths.environment, seed["environment.md"])
    await MemoryFs.ensure(paths.corrections, seed["corrections.md"])
    await writeManifest(root, id)
    const present = await MemoryFs.exists(paths.state)
    const state = present
      ? { ...(await readState(root)), enabled: true, autoInject: true }
      : { ...MemorySchema.create(), enabled: true }
    await writeState(root, state)
    await MemoryAudit.append(root, "enable project source=command")
    return state
  }

  function iso(input?: number) {
    if (!input || !Number.isFinite(input)) return "unknown"
    return new Date(input).toISOString()
  }

  async function inspect(root: string, data: MemorySources.Inventory) {
    const lines: string[] = []
    for (const file of MemorySchema.Sources) {
      const body = await MemorySources.readSource(root, file)
      for (const { section, key, text } of MemoryMarkdown.parse(body)) {
        const id = MemorySources.inventoryKey({ file, section, key })
        const inv = data.items[id]
        const topics = inv?.topics?.length ? inv.topics : MemoryTopics.assign({ file, section, key, text })
        const terms = inv?.terms?.length ? inv.terms : MemoryTopics.terms({ file, section, key, text })
        lines.push(
          [
            `- id=${id}`,
            `type=${MemorySchema.kind(file, section)}`,
            `source=${file}`,
            `section=${section || "unknown"}`,
            `key=${key}`,
            `topics=${topics.join(",") || "unknown"}`,
            `terms=${terms.join(",") || "unknown"}`,
            `updated=${iso(inv?.updatedAt)}`,
            `created=${iso(inv?.createdAt)}`,
            "timeSource=source_mtime_line_offset",
            "stale=no",
            "expires=never",
            `:: ${MemoryText.brief(text, 300)}`,
          ].join(" "),
        )
      }
    }
    return lines.join("\n")
  }

  export async function show(root: string) {
    const state = await readState(root)
    const inventory = await MemorySources.deriveInventory(root)
    return {
      root,
      state,
      sources: {
        project: await MemorySources.readSource(root, "project.md"),
        environment: await MemorySources.readSource(root, "environment.md"),
        corrections: await MemorySources.readSource(root, "corrections.md"),
      },
      index: await readIndex(root),
      inventory,
      items: await inspect(root, inventory),
      changes: await MemoryAudit.readChanges(root),
      decisions: await MemoryAudit.readDecisions(root),
    }
  }

  export async function purge(root: string) {
    const info = await MemoryFs.guard(root)
    if (!info) return false
    if (!info.isDirectory()) throw new Error(`memory root is not a directory: ${root}`)
    if (!(await owned(root))) throw new Error(`refusing to purge unowned memory root: ${root}`)
    await rm(root, { recursive: true, force: true })
    return true
  }
}
