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

  function includes(terms: string[], term: string) {
    const found = new Set(terms)
    if (found.has(term)) return true
    return terms.some((item) => MemoryTopics.related(item, term))
  }

  function has(input: string, term: string) {
    return includes(MemoryShared.terms(input), term)
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
        max: MemorySchema.maxStoredDigestSummary,
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
    const found = new Set(right)
    return MemoryShared.terms(a).filter(
      (term) => found.has(term) || right.some((item) => MemoryTopics.related(item, term)),
    ).length
  }

  function session(input: Hit) {
    return input.type === "digest"
  }

  function label(input: string) {
    return MemorySlug.safe(input, { max: MemorySlug.max.record, fallback: "memory" })
  }

  // A digest is a restatement of a typed hit only when most of its summary (the part after `::`) is
  // already covered by that typed hit — i.e. fewer than half its terms are net-new. A digest that
  // shares the query anchor yet carries substantial new content (dates, decisions) is not a restatement.
  function restates(left: Hit, right: Hit) {
    const known = MemoryShared.terms(right.text)
    const found = new Set(known)
    const terms = MemoryShared.terms(left.text.split("::").slice(1).join("::"))
    if (terms.length === 0) return true
    const novel = terms.filter(
      (term) => !found.has(term) && !known.some((item) => MemoryTopics.related(item, term)),
    ).length
    return novel * 2 < terms.length
  }

  function dedupe(input: { hits: Hit[]; query: string }) {
    const typed = input.hits.filter((hit) => !session(hit))
    return input.hits.filter((hit) => {
      if (!session(hit)) return true
      // Dedupe is hit-to-hit symmetric, so corpus-wide function words do not favor one hit over another.
      // Suppress only genuine restatements: shares the query anchor with a typed hit AND is mostly
      // covered by it. A digest with substantial net-new content survives.
      return !typed.some(
        (item) =>
          overlap(hit.text, item.text) >= 2 && overlap(item.text, input.query) >= 2 && restates(hit, item),
      )
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

  function noise(hits: Hit[]) {
    return MemoryTopics.ubiquitous(hits.map((hit) => MemoryShared.terms(hit.text)))
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
      const block = format({ hits, max: input.maxBytes ?? (input.sessionID ? 6000 : 1200) })
      if (!block) return
      return {
        block,
        hits,
        bytes: Buffer.byteLength(block),
        tokens: MemoryToken.estimate(block),
      }
    }
    // Query terms absent from the corpus add zero to every hit; only corpus-ubiquitous terms need removal.
    const keys = MemoryTopics.expand(MemoryShared.terms(query, { drop: noise([...typedItems, ...digestItems]) }))
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
