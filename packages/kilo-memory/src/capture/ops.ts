import { MemoryFiles } from "../storage/store"
import { MemoryIndexer } from "../recall/indexer"
import { MemoryRedact } from "./redact"
import { MemorySchema } from "../schema"
import { MemoryShared } from "../recall/shared"
import { MemoryTopics } from "../recall/topics"
import { MemorySlug } from "../slug"

/** Low-level raw-root operation applier. Prefer the Memory facade outside package adapters. */
export namespace MemoryOperations {
  export type Add = {
    action: "add"
    file?: MemorySchema.Source
    section?: string
    key: string
    text: string
  }

  export type Remove = {
    action: "remove"
    query: string
  }

  export type Op = Add | Remove

  export type Result = {
    operationCount: number
    added: number
    removed: number
    skipped: Rejection[]
    index: MemoryIndexer.Result
  }

  export type Rejection = {
    reason: "self_referential" | "out_of_scope"
    text: string
  }

  // English best-effort backstop; the typed-consolidation prompt is the primary, language-agnostic defense.
  const self = [
    /\balready\b[^.]{0,120}\b(?:captured|covered|recorded|tracked|represented|saved|known)\b[^.]{0,120}\bmemor(?:y|ies)\b/i,
    /\balready\b[^.]{0,120}\bin\b[^.]{0,120}\bmemor(?:y|ies)\b/i,
    /\bmemor(?:y|ies)\b[^.]{0,120}\balready\b[^.]{0,120}\b(?:captures?|covers?|records?|tracks?|represents?|saves?|knows?|contains?)\b/i,
    /\b(?:was|were)\s+(?:investigated|checked|explored|reviewed)[.;:!?]?\s*$/i,
  ]
  const personal = [
    /^i\s+prefer\b/i,
    /^my\s+preferences?(?:\s+(?:is|are)\b|\b)/i,
    /^(?:the\s+)?user\s+prefers?\b/i,
    /^(?:the\s+)?users\s+preferences?(?:\s+(?:is|are)\b|\b)/i,
  ]
  const sourceMarkers = [
    /\bagents\.md\b/gi,
    /(?:^|[~\/\s])\.claude\/claude\.md\b/gi,
    /\bclaude\.md\b/gi,
    /\bsystem\s*\/\s*developer\b/gi,
  ]

  function key(input: string) {
    const slug = MemorySlug.safe(input.trim(), { max: MemorySlug.max.key, fallback: "", lower: true })
    if (slug) return slug
    return MemorySlug.hash(input, "memory")
  }

  function line(input: Add, max: number) {
    if (MemoryRedact.has(input.text) || MemoryRedact.has(input.key)) {
      throw new Error("memory operation rejected secret-like content")
    }
    const id = key(input.key)
    const text = input.text.trim().replaceAll(/\s+/g, " ")
    const body = text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text
    if (!id) throw new Error("memory operation key is required")
    if (!body) throw new Error("memory operation text is required")
    return { key: id, text: body, line: `- ${id} :: ${body}` }
  }

  type Prepared = {
    op: Add
    file: MemorySchema.Source
    section: string
    key: string
    text: string
    line: string
  }

  function fallback(file: MemorySchema.Source | undefined) {
    if (file === "environment.md") return "Commands"
    if (file === "corrections.md") return "Corrections"
    return "Facts"
  }

  function section(input: string | undefined, file: MemorySchema.Source) {
    const clean = input
      ?.trim()
      .replaceAll(/[\x00-\x1f\x7f]+/g, " ")
      .replaceAll(/\s+/g, " ")
      .replaceAll(/^#+\s*/g, "")
      .replaceAll(/^\-\s+/g, "")
      .replaceAll(/\s+::\s+/g, " ")
      .trim()
      .slice(0, 80)
      .trim()
    return clean || fallback(file)
  }

  function heading(input: Add, file = input.file) {
    return section(input.section, file ?? "project.md")
  }

  function source(input: Add) {
    if (input.file) return input.file
    return "project.md"
  }

  function insert(input: { text: string; section: string; line: string }) {
    const marker = `## ${input.section}`
    const lines = input.text.split("\n")
    const at = lines.findIndex((item) => item.trim() === marker)
    if (at === -1) {
      const next = `${input.text.trimEnd()}\n\n${marker}\n${input.line}\n`
      return { text: next, changed: next !== input.text }
    }
    const end = lines.findIndex((item, idx) => idx > at && item.trim().startsWith("## "))
    const stop = end === -1 ? lines.length : end
    const prefix = input.line.split(" :: ")[0]
    const without = lines.filter(
      (item, idx) => idx <= at || idx >= stop || !item.trim().startsWith(`${prefix} ::`),
    )
    const head = without.slice(0, at + 1)
    const tail = without.slice(at + 1)
    const next = [...head, input.line, ...tail].join("\n")
    return { text: next, changed: next !== input.text }
  }

  type Target = {
    ids: Set<string>
    items: { file: MemorySchema.Source; section: string; key: string }[]
    fallback?: string
  }

  function remove(input: { text: string; file: MemorySchema.Source; target: Target }) {
    if (input.target.items.length === 0 && !input.target.fallback) return { text: input.text, count: 0 }
    const lines = input.text.split("\n")
    let section = "Facts"
    const kept = lines.filter((item) => {
      const line = item.trim()
      if (line.startsWith("## ")) {
        section = line.slice(3).trim() || section
        return true
      }
      if (!line.startsWith("- ") || !line.includes(" :: ")) return true
      const idx = line.indexOf(" :: ")
      const key = line.slice(2, idx).trim()
      if (input.target.fallback === key) return false
      return !input.target.items.some(
        (target) => target.file === input.file && target.section === section && target.key === key,
      )
    })
    return {
      text: kept.join("\n"),
      count: lines.length - kept.length,
    }
  }

  function target(input: { query: string; inventory: MemoryFiles.Inventory }): Target {
    const query = input.query.trim()
    const slug = key(query)
    const ids = new Set<string>()
    const items: Target["items"] = []
    if (!query) return { ids, items }
    for (const [id, item] of Object.entries(input.inventory.items)) {
      const aliases = new Set([id, item.key, `${item.file}:${item.key}`, `${item.file}:${item.section}:${item.key}`])
      if (!aliases.has(query) && (!slug || !aliases.has(slug))) continue
      ids.add(id)
      items.push({ file: item.file, section: item.section, key: item.key })
    }
    return { ids, items, ...(ids.size === 0 ? { fallback: slug || query } : {}) }
  }

  function normalized(input: string) {
    return input
      .trim()
      .toLowerCase()
      .normalize("NFKC")
      .replaceAll(/[`'"“”‘’]/g, "")
      .replaceAll(/[^\p{L}\p{N}_.-]+/gu, " ")
      .replaceAll(/\s+/g, " ")
      .trim()
  }

  function provenance(input: string) {
    const count = sourceMarkers.reduce((sum, rule) => sum + (input.match(rule)?.length ?? 0), 0)
    if (/(?:^|[~\/\s])\.claude\/claude\.md\b/i.test(input)) return true
    return count >= 3
  }

  export function reject(input: Add): Rejection | undefined {
    const raw = input.text.trim()
    const value = normalized(raw)
    if (personal.some((rule) => rule.test(value))) return { reason: "out_of_scope", text: input.text }
    if (provenance(raw)) return { reason: "out_of_scope", text: input.text }
    if (!self.some((rule) => rule.test(value))) return
    return { reason: "self_referential", text: input.text }
  }

  function prepare(input: { state: MemorySchema.State; ops: Op[]; max: number }) {
    const skipped: Rejection[] = []
    const adds = input.ops
      .filter((item): item is Add => item.action === "add")
      .filter((op) => {
        const item = reject(op)
        if (!item) return true
        skipped.push(item)
        return false
      })
      .map((op) => {
        const file = source(op)
        if (!(MemorySchema.Sources as readonly MemorySchema.Source[]).includes(file)) {
          throw new Error(`memory source ${file} is not valid for project`)
        }
        const section = heading(op, file)
        const item = line(op, input.max)
        return {
          op,
          file,
          section,
          key: item.key,
          text: item.text,
          line: item.line,
        } satisfies Prepared
      })
    return { adds, skipped }
  }

  function words(input: string) {
    return MemoryShared.terms(normalized(input))
  }

  function similar(left: string, right: string) {
    const a = normalized(left)
    const b = normalized(right)
    if (!a || !b) return false
    if (a === b) return true
    if (Math.min(a.length, b.length) >= 24 && (a.includes(b) || b.includes(a))) return true
    const one = words(a)
    const two = words(b)
    const min = Math.min(one.length, two.length)
    if (min < 4) return false
    const overlap = one.filter((item) => two.includes(item)).length
    return overlap / min >= 0.85
  }

  function duplicate(input: { item: Prepared; inventory: MemoryFiles.Inventory }) {
    return Object.values(input.inventory.items).find(
      (item) =>
        item.file === input.item.file &&
        item.section === input.item.section &&
        (item.key === input.item.key || similar(item.text, input.item.text)),
    )
  }

  function rekey(input: { item: Prepared; key: string }) {
    return {
      ...input.item,
      key: input.key,
      line: `- ${input.key} :: ${input.item.text}`,
    } satisfies Prepared
  }

  export async function apply(input: { root: string; ops: Op[] }) {
    return MemoryFiles.queue(input.root, async () => {
      const state = await MemoryFiles.readState(input.root)
      if (!state.enabled) throw new Error(`${state.scope} memory is disabled`)
      const max = state.limits.maxLineChars
      const inventory = await MemoryFiles.deriveInventory(input.root)
      if (input.ops.length > state.capture.maxOpsPerRun) {
        throw new Error(`memory operation limit exceeded: ${input.ops.length}/${state.capture.maxOpsPerRun}`)
      }
      const ops = input.ops
      const prepared = prepare({ state, ops, max })
      let removed = 0
      let added = 0
      let count = 0
      for (const op of ops.filter((item) => item.action === "remove")) {
        const exact = target({ query: op.query, inventory })
        for (const source of MemorySchema.Sources) {
          const prior = await MemoryFiles.readSource(input.root, source)
          const next = remove({ text: prior, file: source, target: exact })
          removed += next.count
          if (next.count > 0) await MemoryFiles.writeSource(input.root, source, next.text)
        }
        for (const id of exact.ids) delete inventory.items[id]
        if (exact.fallback) {
          for (const [id, item] of Object.entries(inventory.items)) {
            if (exact.fallback === item.key) delete inventory.items[id]
          }
        }
        count++
      }

      for (const item of prepared.adds) {
        const found = duplicate({ item, inventory })
        const nextItem = found ? rekey({ item, key: found.key }) : item
        const source = await MemoryFiles.readSource(input.root, item.file)
        const next = insert({ text: source, section: nextItem.section, line: nextItem.line })
        if (next.changed) await MemoryFiles.writeSource(input.root, nextItem.file, next.text)
        const id = MemoryFiles.inventoryKey({ file: nextItem.file, section: nextItem.section, key: nextItem.key })
        const inv = inventory.items[id]
        if (!next.changed && inv) continue
        const now = Date.now()
        const topics = MemoryTopics.assign({
          file: nextItem.file,
          section: nextItem.section,
          key: nextItem.key,
          text: nextItem.text,
        })
        const terms = MemoryTopics.terms({
          file: nextItem.file,
          section: nextItem.section,
          key: nextItem.key,
          text: nextItem.text,
        })
        inventory.items[id] = {
          file: nextItem.file,
          section: nextItem.section,
          key: nextItem.key,
          text: nextItem.text,
          topics,
          terms,
          createdAt: inv?.createdAt ?? now,
          updatedAt: now,
        }
        added++
        count++
      }
      const index = await MemoryIndexer.rebuild({ root: input.root, state })
      await MemoryFiles.writeState(input.root, {
        ...state,
        stats: {
          ...state.stats,
          lastOperationCount: count,
        },
      })
      await MemoryFiles.append(input.root, `apply ops=${count} removed=${removed}`)
      return { operationCount: count, added, removed, skipped: prepared.skipped, index } satisfies Result
    })
  }

  export async function forget(input: { root: string; query: string }) {
    return apply({ root: input.root, ops: [{ action: "remove", query: input.query }] })
  }
}
