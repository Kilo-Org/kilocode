import { MemoryFiles } from "../storage/store"
import { MemoryIndexer } from "../recall/indexer"
import { MemoryMarkdown } from "../storage/markdown"
import { MemoryRedact } from "./redact"
import { MemoryReject } from "./reject"
import { MemorySchema } from "../schema"
import { MemoryShared } from "../recall/shared"
import { MemoryText } from "../text"
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

  // Content gating lives in MemoryReject; re-exported so MemoryOperations.reject/Rejection stay the stable surface.
  // A secret-like op is skipped (not thrown) so one redacted op cannot abort the whole batch.
  export type Rejection = MemoryReject.Rejection | { reason: "secret"; text: string }
  export const reject = MemoryReject.reject

  function key(input: string) {
    const slug = MemorySlug.safe(input.trim(), { max: MemorySlug.max.key, fallback: "", lower: true })
    if (slug) return slug
    return MemorySlug.hash(input, "memory")
  }

  function secret(input: Add) {
    return MemoryRedact.has(input.text) || MemoryRedact.has(input.key)
  }

  function line(input: Add, max: number) {
    const id = key(input.key)
    const body = MemoryText.brief(input.text, max)
    if (!id) throw new Error("memory operation key is required")
    if (!body) throw new Error("memory operation text is required")
    return { key: id, text: body, line: MemoryMarkdown.line(id, body) }
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

  type Target = {
    ids: Set<string>
    items: { file: MemorySchema.Source; section: string; key: string }[]
    fallback?: string
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

  function prepare(input: { state: MemorySchema.State; ops: Op[]; max: number }) {
    const skipped: Rejection[] = []
    const adds = input.ops
      .filter((item): item is Add => item.action === "add")
      // Redact rejected text too: this filter runs before the secret one, so a rejected op never
      // reaches it, and skips flow into the persistent decisions audit (/memory/show, TUI).
      .filter((op) => {
        const item = reject(op)
        if (!item) return true
        skipped.push({ ...item, text: MemoryRedact.text(item.text) })
        return false
      })
      // Skip secret-like ops (record a `secret` skip) instead of throwing so the rest of the batch applies.
      .filter((op) => {
        if (!secret(op)) return true
        skipped.push({ reason: "secret", text: MemoryRedact.text(op.text) })
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
    return MemoryShared.terms(MemoryText.normalized(input))
  }

  function similar(left: string, right: string) {
    const a = MemoryText.normalized(left)
    const b = MemoryText.normalized(right)
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
      line: MemoryMarkdown.line(input.key, input.item.text),
    } satisfies Prepared
  }

  function validate(input: { state: MemorySchema.State; ops: Op[] }) {
    if (!input.state.enabled) throw new Error(`${input.state.scope} memory is disabled`)
    if (input.ops.length <= input.state.capture.maxOpsPerRun) return
    throw new Error(`memory operation limit exceeded: ${input.ops.length}/${input.state.capture.maxOpsPerRun}`)
  }

  function entry(input: { item: Prepared; prior?: MemoryFiles.InventoryItem; now: number }) {
    const topics = MemoryTopics.assign({
      file: input.item.file,
      section: input.item.section,
      key: input.item.key,
      text: input.item.text,
    })
    const terms = MemoryTopics.terms({
      file: input.item.file,
      section: input.item.section,
      key: input.item.key,
      text: input.item.text,
    })
    return {
      file: input.item.file,
      section: input.item.section,
      key: input.item.key,
      text: input.item.text,
      topics,
      terms,
      createdAt: input.prior?.createdAt ?? input.now,
      updatedAt: input.now,
    } satisfies MemoryFiles.InventoryItem
  }

  // In-memory copy of every source document, edited purely before any write reaches disk.
  type Docs = Map<MemorySchema.Source, string>

  type Plan = {
    docs: Docs
    touched: Set<MemorySchema.Source>
    inventory: MemoryFiles.Inventory
    added: number
    removed: number
    count: number
  }

  // Pure: delete matching lines from the in-memory documents and drop them from the working inventory.
  function planRemove(plan: Plan, op: Remove) {
    const exact = target({ query: op.query, inventory: plan.inventory })
    for (const source of MemorySchema.Sources) {
      const next = MemoryMarkdown.remove({
        text: plan.docs.get(source) ?? "",
        match: (item) =>
          exact.fallback === item.key ||
          exact.items.some((t) => t.file === source && t.section === item.section && t.key === item.key),
      })
      if (next.count === 0) continue
      plan.docs.set(source, next.text)
      plan.touched.add(source)
      plan.removed += next.count
    }
    for (const id of exact.ids) delete plan.inventory.items[id]
    if (exact.fallback) {
      for (const [id, item] of Object.entries(plan.inventory.items)) {
        if (exact.fallback === item.key) delete plan.inventory.items[id]
      }
    }
    plan.count++
  }

  // Pure: dedupe against the working inventory, edit the in-memory document, and record the inventory entry.
  function planAdd(plan: Plan, item: Prepared, now: number) {
    const found = duplicate({ item, inventory: plan.inventory })
    const next = found ? rekey({ item, key: found.key }) : item
    const result = MemoryMarkdown.upsert({
      text: plan.docs.get(next.file) ?? "",
      section: next.section,
      line: next.line,
    })
    if (result.changed) {
      plan.docs.set(next.file, result.text)
      plan.touched.add(next.file)
    }
    const id = MemoryFiles.inventoryKey({ file: next.file, section: next.section, key: next.key })
    const prior = plan.inventory.items[id]
    if (!result.changed && prior) return
    plan.inventory.items[id] = entry({ item: next, prior, now })
    plan.added++
    plan.count++
  }

  // Pure: sequence removes-then-adds over the loaded documents and inventory, yielding the edits to persist.
  function planOps(input: {
    docs: Docs
    inventory: MemoryFiles.Inventory
    removes: Remove[]
    adds: Prepared[]
    now: number
  }): Plan {
    const plan: Plan = {
      docs: input.docs,
      touched: new Set(),
      inventory: input.inventory,
      added: 0,
      removed: 0,
      count: 0,
    }
    for (const op of input.removes) planRemove(plan, op)
    for (const item of input.adds) planAdd(plan, item, input.now)
    return plan
  }

  async function readDocs(root: string): Promise<Docs> {
    const docs: Docs = new Map()
    for (const source of MemorySchema.Sources) docs.set(source, await MemoryFiles.readSource(root, source))
    return docs
  }

  async function writeDocs(input: { root: string; plan: Plan }) {
    for (const source of input.plan.touched) {
      await MemoryFiles.writeSource(input.root, source, input.plan.docs.get(source) ?? "")
    }
  }

  async function persist(input: { root: string; state: MemorySchema.State; count: number; removed: number }) {
    const index = await MemoryIndexer.rebuild({ root: input.root, state: input.state })
    await MemoryFiles.writeState(input.root, {
      ...input.state,
      stats: {
        ...input.state.stats,
        lastOperationCount: input.count,
      },
    })
    await MemoryFiles.append(input.root, `apply ops=${input.count} removed=${input.removed}`)
    return index
  }

  /** Resolve an auto-capture batch into safe-to-apply adds plus the removes worth honoring.
   * - adds pass through (an upsert on an existing key updates it in place during apply);
   * - a remove superseded by a same-batch add on the same key is dropped (the add already updates it);
   * - a remove whose query exactly matches an existing entry key/id is kept (bounded, auditable);
   * - any fuzzy remove that matches no existing key is dropped (hard removes stay explicit-only). */
  export function reconcile(input: { ops: Op[]; keys: Iterable<string> }): { ops: Add[]; removes: Remove[] } {
    const keys = new Set(input.keys)
    const adds = input.ops.filter((item): item is Add => item.action === "add")
    const superseded = new Set<string>()
    for (const add of adds) {
      if (add.key) superseded.add(add.key.trim())
      if (add.file) superseded.add(`${add.file}:${add.section ?? ""}:${add.key.trim()}`)
    }
    const seen = new Set<string>()
    const removes: Remove[] = []
    for (const item of input.ops) {
      if (item.action !== "remove") continue
      const query = item.query.trim()
      if (!query || seen.has(query)) continue
      if (superseded.has(query)) continue
      if (!keys.has(query)) continue
      seen.add(query)
      removes.push({ action: "remove", query })
    }
    return { ops: adds, removes }
  }

  export async function apply(input: { root: string; ops: Op[] }) {
    return MemoryFiles.queue(input.root, async () => {
      // Load (IO): state, working inventory, and every source document.
      const state = await MemoryFiles.readState(input.root)
      validate({ state, ops: input.ops })
      const inventory = await MemoryFiles.deriveInventory(input.root)
      const docs = await readDocs(input.root)
      // Plan (pure): validate/normalize ops, then dedupe + edit documents + update inventory in memory.
      const prepared = prepare({ state, ops: input.ops, max: state.limits.maxLineChars })
      const removes = input.ops.filter((item): item is Remove => item.action === "remove")
      const plan = planOps({ docs, inventory, removes, adds: prepared.adds, now: Date.now() })
      // Commit (IO): write changed documents, then rebuild the index, persist state, and audit.
      await writeDocs({ root: input.root, plan })
      const index = await persist({ root: input.root, state, count: plan.count, removed: plan.removed })
      return {
        operationCount: plan.count,
        added: plan.added,
        removed: plan.removed,
        skipped: prepared.skipped,
        index,
      } satisfies Result
    })
  }

  export async function forget(input: { root: string; query: string }) {
    return apply({ root: input.root, ops: [{ action: "remove", query: input.query }] })
  }
}
