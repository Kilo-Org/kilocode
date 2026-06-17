import { MemoryBudget } from "./budget"
import { MemoryDigest } from "../capture/digest"
import { MemoryFiles } from "../storage/store"
import { MemoryIndexFormat } from "./index-format"
import { MemorySchema } from "../schema"
import { MemoryShared } from "./shared"

export namespace MemoryIndexer {
  // Budget/envelope concerns live in MemoryBudget; re-exported here to keep MemoryIndexer.* the stable facade.
  export type Result = MemoryBudget.Result
  export const cap = MemoryBudget.cap
  export const fresh = MemoryBudget.fresh
  export const stale = MemoryBudget.stale

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

  function session(input: Digest, opts: { limits: MemorySchema.Limits; latest?: boolean }) {
    const topic = input.topic.replaceAll('"', "'")
    const max = opts.latest ? digest.latest(opts.limits) : digest.recent
    const summary = MemoryShared.brief(input.summary, max)
    return MemoryIndexFormat.record({
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
    const initial = MemoryBudget.result({ root: input.root, limits: input.limits, lines: primary, max: input.max })
    if (has({ text: initial.text, lines: keep })) return initial
    return MemoryBudget.result({
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
    const corrections = MemoryIndexFormat.lines("CORRECTION", correctionItems)
    const projectItems = MemoryShared.typed({
      file: "project.md",
      text: await MemoryFiles.readSource(input.root, "project.md"),
      max: state.limits.maxLineChars,
      inventory,
    })
    const important = MemoryIndexFormat.project(projectItems, { include: ["PROJECT_DECISION", "PROJECT_CONSTRAINT"] })
    const facts = MemoryIndexFormat.project(projectItems, { exclude: ["PROJECT_DECISION", "PROJECT_CONSTRAINT"] })
    const top = facts.slice(0, reserved.facts)
    const rest = facts.slice(reserved.facts)
    const environmentItems = MemoryShared.typed({
      file: "environment.md",
      text: await MemoryFiles.readSource(input.root, "environment.md"),
      max: state.limits.maxLineChars,
      inventory,
    })
    const environment = MemoryIndexFormat.lines("ENV", environmentItems)
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
      hints: MemoryIndexFormat.hints(all),
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
