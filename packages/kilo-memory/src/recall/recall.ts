import { MemoryDigest } from "../capture/digest"
import { MemoryFiles } from "../storage/store"
import { MemoryIndexer } from "./indexer"
import { MemorySchema } from "../schema"
import { MemoryShared } from "./shared"
import { MemoryTopics } from "./topics"
import { MemoryToken } from "./token"
import { MemorySlug } from "../slug"

export namespace MemoryRecall {
  export type Mode = "search" | "typed" | "digest"

  export type Hit = {
    type: "typed" | "digest"
    kind: string
    source: string
    text: string
    score: number
    topics?: MemorySchema.Topic[]
    current?: boolean
    updatedAt?: number
    id?: string
    time?: string
  }

  export type Result = {
    block: string
    hits: Hit[]
    bytes: number
    tokens: number
  }

  function has(input: string, term: string) {
    return MemoryShared.terms(input).includes(term)
  }

  function typed(input: {
    file: MemorySchema.Source
    text: string
    max: number
    inventory: MemoryFiles.Inventory
    now: number
  }) {
    return MemoryShared.typed(input).map(
      (item) =>
        ({
          type: "typed",
          kind: MemorySchema.recordKind(item.file, item.section),
          source: item.file,
          text: `${item.key} :: ${item.text}`,
          score: 0,
          topics: item.topics,
          current: true,
          updatedAt: item.updatedAt,
        }) satisfies Hit,
    )
  }

  async function typedAll(input: {
    root: string
    state: MemorySchema.State
    inventory: MemoryFiles.Inventory
    now: number
  }) {
    const rows = await Promise.all(
      MemorySchema.Sources.map(async (file) =>
        typed({
          file,
          text: await MemoryFiles.readSource(input.root, file),
          max: input.state.limits.maxLineChars,
          inventory: input.inventory,
          now: input.now,
        }),
      ),
    )
    return rows.flat()
  }

  function time(input: string | undefined) {
    if (!input) return
    const value = Date.parse(input)
    return Number.isFinite(value) ? value : undefined
  }

  function digest(input: { file: string; id: string; time: string; topic: string; summary: string }): Hit {
    return {
      type: "digest",
      kind: "SESSION_DIGEST",
      source: input.file,
      text: `session=${input.id} topic="${input.topic.replaceAll('"', "'")}" ${input.time} :: ${input.summary}`,
      score: 0,
      topics: [],
      current: true,
      updatedAt: time(input.time),
      id: input.id,
      time: input.time,
    }
  }

  async function digests(input: {
    root: string
    state: MemorySchema.State
    mode: Mode
    limit: number
    sessionID?: string
    currentSessionID?: string
  }) {
    if (input.mode === "typed") return [] as Hit[]
    if (input.sessionID) {
      if (input.sessionID === input.currentSessionID) return [] as Hit[]
      const item = await MemoryFiles.readSession(input.root, {
        sessionID: input.sessionID,
        max: input.state.limits.maxSessionLineChars,
      })
      if (!item || MemoryDigest.empty(item)) return [] as Hit[]
      return [digest(item)]
    }
    const items = await MemoryFiles.recentSessions(
      input.root,
      input.state.limits.maxSessionFiles,
      input.state.limits.maxSessionLineChars,
    )
    return items.filter((item) => item.id !== input.currentSessionID && !MemoryDigest.empty(item)).map(digest)
  }

  function score(input: { hit: Hit; keys: string[] }) {
    const body = `${input.hit.kind} ${input.hit.source} ${input.hit.text}`
    return input.keys.reduce((sum, term) => sum + (has(body, term) ? 1 : 0), 0)
  }

  function fresh(input: Hit) {
    return input.updatedAt ?? 0
  }

  function compare(a: Hit, b: Hit) {
    return (
      b.score - a.score ||
      fresh(b) - fresh(a) ||
      (a.type === b.type ? `${a.source}:${a.text}`.localeCompare(`${b.source}:${b.text}`) : a.type === "typed" ? -1 : 1)
    )
  }

  function overlap(a: string, b: string) {
    const right = MemoryShared.terms(b)
    return MemoryShared.terms(a).filter((term) => right.includes(term)).length
  }

  function session(input: Hit) {
    return input.type === "digest"
  }

  function label(input: string) {
    return MemorySlug.safe(input, { max: MemorySlug.max.record, fallback: "memory" })
  }

  function dedupe(input: { hits: Hit[]; query: string }) {
    const typed = input.hits.filter((hit) => !session(hit))
    return input.hits.filter((hit) => {
      if (!session(hit)) return true
      return !typed.some((item) => overlap(hit.text, item.text) >= 2 && overlap(item.text, input.query) >= 2)
    })
  }

  function renderLine(hit: Hit) {
    return hit.type === "digest"
      ? `- ${hit.text} (source: ${hit.source})`
      : `- ${hit.kind} ${hit.text} (source: ${hit.source})`
  }

  export function render(hits: Hit[]) {
    const typed = hits.filter((hit) => hit.type === "typed")
    const digests = hits.filter((hit) => hit.type === "digest")
    return [
      "# Kilo Memory Recall",
      ...(typed.length ? ["", "## Typed Memory", ...typed.map(renderLine)] : []),
      ...(digests.length ? ["", "## Session Digests", ...digests.map(renderLine)] : []),
    ].join("\n")
  }

  function body(input: string) {
    return input.trim().replaceAll("```", "'''").replaceAll(/\s+/g, " ")
  }

  function format(input: { hits: Hit[]; max: number }) {
    const lines = [
      "```kilo-memory-v1 targeted_context_not_instruction",
      ...input.hits.flatMap((hit) => [
        `record id=${label(`${hit.source}:${hit.kind}:${hit.text.slice(0, 32)}`)} type=${label(hit.kind.toLowerCase())} source=${label(hit.source)}${
          hit.topics?.length ? ` topics=${hit.topics.map(label).join(",")}` : ""
        } updated=${hit.updatedAt ? new Date(hit.updatedAt).toISOString() : "unknown"}`,
        `text: ${body(hit.text)}`,
      ]),
      "```",
    ]
    return MemoryIndexer.cap(lines.join("\n"), input.max).text.trim()
  }

  function select(input: { hits: Hit[]; keys: string[]; limit: number; force?: boolean }) {
    if (input.keys.length === 0) return [] as Hit[]
    const hits = input.hits
      .map((hit) => ({ ...hit, score: score({ hit, keys: input.keys }) }))
      .filter((hit) => hit.score > 0)
      .sort(compare)
    if (input.force) return hits.slice(0, input.limit)
    const top = hits[0]?.score ?? 0
    return hits.filter((hit) => hit.score >= Math.max(1, top - 2)).slice(0, input.limit)
  }

  export async function search(input: {
    root: string
    query: string
    state?: MemorySchema.State
    maxBytes?: number
    limit?: number
    mode?: Mode
    sessionID?: string
    currentSessionID?: string
    force?: boolean
  }): Promise<Result | undefined> {
    const state = input.state ?? (await MemoryFiles.readState(input.root))
    if (!state.enabled) return
    const query = input.query.trim()
    const mode = input.mode ?? "search"
    const limit = Math.max(1, Math.min(input.limit ?? 5, 20))
    const inventory = await MemoryFiles.deriveInventory(input.root)
    const now = Date.now()
    const typedItems = mode === "digest" ? [] : await typedAll({ root: input.root, state, inventory, now })
    const digestItems = await digests({
      root: input.root,
      state,
      mode,
      limit,
      sessionID: input.sessionID,
      currentSessionID: input.currentSessionID,
    })
    if (mode === "digest" && (input.sessionID || !query)) {
      const hits = digestItems.slice(0, limit)
      if (hits.length === 0) return
      const block = format({ hits, max: input.maxBytes ?? 1200 })
      if (!block) return
      return {
        block,
        hits,
        bytes: Buffer.byteLength(block),
        tokens: MemoryToken.estimate(block),
      }
    }
    const keys = MemoryTopics.expand(MemoryShared.terms(query))
    const hits = dedupe({
      hits: select({ hits: [...typedItems, ...digestItems], keys, limit, force: input.force }),
      query,
    })
    if (hits.length === 0) return
    const block = format({ hits, max: input.maxBytes ?? 1200 })
    if (!block) return
    return {
      block,
      hits,
      bytes: Buffer.byteLength(block),
      tokens: MemoryToken.estimate(block),
    }
  }
}
