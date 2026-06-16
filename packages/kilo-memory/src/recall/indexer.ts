import { MemoryToken } from "./token"
import path from "path"
import { MemoryDigest } from "../capture/digest"
import { MemoryFiles } from "../storage/store"
import { MemorySchema } from "../schema"
import { MemoryShared } from "./shared"
import { MemorySlug } from "../slug"

export namespace MemoryIndexer {
  export type Result = {
    text: string
    bytes: number
    tokens: number
    truncated: boolean
  }

  type Item = MemoryShared.TypedItem
  type Digest = { id: string; topic: string; time: string; summary: string }

  export const digest = {
    recent: 240,
    latest(input: MemorySchema.Limits) {
      return input.maxSessionLineChars
    },
  }
  const reserved = {
    facts: 8,
    environment: 12,
  }

  function type(section: string) {
    return MemorySchema.recordKind("project.md", section)
  }

  function rank(section: string) {
    const kind = type(section)
    if (kind === "PROJECT_DECISION") return 0
    if (kind === "PROJECT_CONSTRAINT") return 1
    if (kind === "PROJECT_FACT") return 2
    return 3
  }

  function id(input: string) {
    return MemorySlug.safe(input, { max: MemorySlug.max.record, fallback: "memory" })
  }

  function text(input: string) {
    return input.trim().replaceAll("```", "'''").replaceAll(/\s+/g, " ")
  }

  function date(input?: number | string) {
    if (typeof input === "string") return input.replaceAll(/\s+/g, "_")
    if (typeof input === "number" && Number.isFinite(input)) return new Date(input).toISOString()
    return "unknown"
  }

  function record(input: { kind: string; id: string; source: string; updated?: number | string; text: string }) {
    return [
      `record id=${id(input.id)} type=${id(input.kind.toLowerCase())} source=${id(input.source)} updated=${date(input.updated)}`,
      `text: ${text(input.text)}`,
    ].join("\n")
  }

  function lines(prefix: string, items: Item[]) {
    return items.map((item) =>
      record({
        kind: prefix,
        id: MemoryFiles.inventoryKey({ file: item.file, section: item.section, key: item.key }),
        source: item.file,
        updated: item.updatedAt,
        text: `${item.key} :: ${item.text}`,
      }),
    )
  }

  // One compact record mapping topics to the files holding them, so the model knows what kilo_memory_recall can find.
  function hints(items: Item[]) {
    const rows = MemorySchema.Topics.flatMap((topic) => {
      const group = items.filter((item) => item.topics.includes(topic))
      if (group.length === 0) return []
      const files = [...new Set(group.map((item) => item.file))].sort().join(",")
      const latest = Math.max(...group.map((item) => item.updatedAt ?? 0))
      return [{ text: `topic=${topic} sources=${files} records=${group.length}`, latest }]
    })
    if (rows.length === 0) return []
    return [
      record({
        kind: "TOPIC_HINT",
        id: "topic.map",
        source: "inventory",
        updated: Math.max(...rows.map((row) => row.latest)) || "unknown",
        text: rows.map((row) => row.text).join(" | "),
      }),
    ]
  }

  function project(items: Item[], input?: { include?: string[]; exclude?: string[] }) {
    const include = new Set(input?.include ?? [])
    const exclude = new Set(input?.exclude ?? [])
    return [...items]
      .filter((item) => {
        const kind = type(item.section)
        if (include.size > 0 && !include.has(kind)) return false
        return !exclude.has(kind)
      })
      .sort((a, b) => rank(a.section) - rank(b.section))
      .map((item) =>
        record({
          kind: type(item.section),
          id: MemoryFiles.inventoryKey({ file: item.file, section: item.section, key: item.key }),
          source: item.file,
          updated: item.updatedAt,
          text: `${item.key} :: ${item.text}`,
        }),
      )
  }

  function rootName(root: string) {
    const dir = path.basename(root)
    return dir || "project"
  }

  export function fingerprint(limits: MemorySchema.Limits) {
    return `limits: ${limits.maxProjectIndexBytes}/${limits.maxRecentSessions}/${limits.maxSessionLineChars}`
  }

  /** True when the index was built with the same limits; a limits change must invalidate it. */
  export function fresh(input: string, limits: MemorySchema.Limits) {
    return input.includes(`\n${fingerprint(limits)}\n`)
  }

  function wrap(input: { root: string; limits: MemorySchema.Limits; lines: string[] }) {
    if (input.lines.length === 0) return ""
    return [
      "```kilo-memory-v1 context_not_instruction",
      "scope: project",
      `root: ${rootName(input.root)}`,
      fingerprint(input.limits),
      "",
      ...input.lines,
      "```",
      "",
    ].join("\n")
  }

  export function cap(input: string, max: number): Result {
    if (!input.trim()) return { text: "", bytes: 0, tokens: 0, truncated: false }
    const all = input.endsWith("\n") ? input : `${input}\n`
    if (Buffer.byteLength(all) <= max) {
      return {
        text: all,
        bytes: Buffer.byteLength(all),
        tokens: MemoryToken.estimate(all),
        truncated: false,
      }
    }

    const lines = all.split("\n")
    const close = lines.findIndex((line, idx) => idx > 0 && line.trim() === "```")
    if (lines[0]?.startsWith("```kilo-memory-v1") && close > 0) {
      const foot = `${lines[close]}\n`
      // This branch always truncates, so reserve room for a note telling the model how to list the
      // rest — but never at tiny budgets where the note would displace actual memory.
      const note = "note: index truncated; call kilo_memory_recall mode=catalog to list all stored memory keys"
      const reserve = max >= 1024 ? Buffer.byteLength(`${note}\n`) : 0
      const kept = [lines[0]]
      let bytes = Buffer.byteLength(`${lines[0]}\n`) + Buffer.byteLength(foot) + reserve
      for (const line of lines.slice(1, close)) {
        const next = `${line}\n`
        const size = Buffer.byteLength(next)
        if (bytes + size > max) break
        kept.push(line)
        bytes += size
      }
      while (kept.at(-1)?.startsWith("record ")) kept.pop()
      if (reserve) kept.push(note)
      const text = `${kept.join("\n")}\n${foot}`
      if (Buffer.byteLength(text) <= max) {
        return {
          text,
          bytes: Buffer.byteLength(text),
          tokens: MemoryToken.estimate(text),
          truncated: true,
        }
      }
    }
    const kept: string[] = []
    let bytes = 0
    for (const line of lines) {
      const next = `${line}\n`
      const size = Buffer.byteLength(next)
      if (bytes + size > max) break
      kept.push(line)
      bytes += size
    }
    const text = `${kept.join("\n")}\n`
    return {
      text,
      bytes: Buffer.byteLength(text),
      tokens: MemoryToken.estimate(text),
      truncated: true,
    }
  }

  export function stale(input: string) {
    return !input.trimStart().startsWith("```kilo-memory-v1")
  }

  function session(input: Digest, opts: { limits: MemorySchema.Limits; latest?: boolean }) {
    const topic = input.topic.replaceAll('"', "'")
    const max = opts.latest ? digest.latest(opts.limits) : digest.recent
    const summary = MemoryShared.brief(input.summary, max)
    return record({
      kind: opts?.latest ? "LATEST_SESSION_DIGEST" : "SESSION_DIGEST",
      id: `${opts?.latest ? "latest_session" : "session"}.${input.id}`,
      source: `${input.id}.md`,
      updated: input.time,
      text: `session=${input.id} topic="${topic}" ${input.time} :: ${summary}`,
    })
  }

  function hits(left: string[], right: string[]) {
    const found = new Set(right)
    return left.filter((item) => found.has(item)).length
  }

  function covered(input: { digest: Digest; items: Item[] }) {
    const label = MemoryShared.terms(input.digest.topic)
    if (label.length < 2) return false
    const detail = MemoryShared.terms(input.digest.summary)
    return input.items.some((item) => {
      const body = MemoryShared.terms(`${item.key} ${item.text}`)
      if (hits(label, body) < label.length) return false
      if (label.length >= 3) return true
      return detail.length >= 2 && hits(detail, body) >= 2
    })
  }

  function topic(input: string) {
    return input.toLowerCase().trim().replaceAll(/\s+/g, " ")
  }

  function distinct<T extends { topic: string }>(recent: T[]) {
    const topics = new Set<string>()
    return recent.filter((item) => {
      const value = topic(item.topic)
      if (!value) return true
      if (topics.has(value)) return false
      topics.add(value)
      return true
    })
  }

  function result(input: {
    root: string
    limits: MemorySchema.Limits
    lines: string[]
    max: number
  }) {
    return cap(wrap({ root: input.root, limits: input.limits, lines: input.lines }), input.max)
  }

  function has(input: { text: string; lines: string[] }) {
    return input.lines.every((line) => {
      const id = line.match(/\bsession=([^\s]+)/)?.[1]
      return id ? input.text.includes(`session=${id}`) : input.text.includes(line)
    })
  }

  function assemble(input: {
    root: string
    limits: MemorySchema.Limits
    max: number
    current: string[]
    corrections: string[]
    important: string[]
    top: string[]
    topEnv: string[]
    hints: string[]
    rest: string[]
    environment: string[]
    sessions: string[]
  }) {
    const keep = input.current
    // Topic hints are compact recall routing (topic -> source files); keep them ahead of older sessions and bulk facts.
    const primary = [
      ...input.corrections,
      ...input.current,
      ...input.important,
      ...input.top,
      ...input.topEnv,
      ...input.hints,
      ...input.sessions,
      ...input.rest,
      ...input.environment,
    ]
    const initial = result({
      root: input.root,
      limits: input.limits,
      lines: primary,
      max: input.max,
    })
    if (has({ text: initial.text, lines: keep })) return initial
    return result({
      root: input.root,
      limits: input.limits,
      lines: [
        ...input.current,
        ...input.corrections,
        ...input.important,
        ...input.top,
        ...input.topEnv,
        ...input.hints,
        ...input.sessions,
        ...input.rest,
        ...input.environment,
      ],
      max: input.max,
    })
  }

  export async function build(input: { root: string; state?: MemorySchema.State }): Promise<Result> {
    const state = input.state ?? (await MemoryFiles.readState(input.root))
    const max = state.limits.maxProjectIndexBytes
    const inventory = await MemoryFiles.deriveInventory(input.root)
    const correctionItems = MemoryShared.typed({
      file: "corrections.md",
      text: await MemoryFiles.readSource(input.root, "corrections.md"),
      max: state.limits.maxLineChars,
      inventory,
    })
    const corrections = lines("CORRECTION", correctionItems)
    const projectItems = MemoryShared.typed({
      file: "project.md",
      text: await MemoryFiles.readSource(input.root, "project.md"),
      max: state.limits.maxLineChars,
      inventory,
    })
    const important = project(projectItems, { include: ["PROJECT_DECISION", "PROJECT_CONSTRAINT"] })
    const facts = project(projectItems, { exclude: ["PROJECT_DECISION", "PROJECT_CONSTRAINT"] })
    const top = facts.slice(0, reserved.facts)
    const rest = facts.slice(reserved.facts)
    const environmentItems = MemoryShared.typed({
      file: "environment.md",
      text: await MemoryFiles.readSource(input.root, "environment.md"),
      max: state.limits.maxLineChars,
      inventory,
    })
    const environment = lines("ENV", environmentItems)
    const topEnv = environment.slice(0, reserved.environment)
    const restEnv = environment.slice(reserved.environment)
    const all = [...correctionItems, ...projectItems, ...environmentItems]
    const durable = [...projectItems, ...environmentItems]
    const recent = await MemoryFiles.recentSessions(
      input.root,
      state.limits.maxSessionFiles,
      state.limits.maxSessionLineChars,
    )
    // The continuity pointer must be the true newest session. Only older bulk digests are curated by empty().
    const current = recent[0] ? [session(recent[0], { limits: state.limits, latest: true })] : []
    const sessions = distinct(recent.slice(1).filter((item) => !MemoryDigest.empty(item)))
      .filter((item) => !covered({ digest: item, items: durable }))
      .slice(0, Math.max(0, state.limits.maxRecentSessions - current.length))
      .map((item) => session(item, { limits: state.limits }))
    return assemble({
      root: input.root,
      limits: state.limits,
      max,
      current,
      corrections,
      important,
      top,
      topEnv,
      hints: hints(all),
      rest,
      environment: restEnv,
      sessions,
    })
  }

  export async function rebuild(input: { root: string; state?: MemorySchema.State }) {
    return MemoryFiles.queue(input.root, async () => {
      const result = await build(input)
      await MemoryFiles.writeIndex(input.root, result.text)
      await MemoryFiles.append(input.root, `regenerate index.kmem bytes=${result.bytes} tokens=${result.tokens}`)
      return result
    })
  }
}
