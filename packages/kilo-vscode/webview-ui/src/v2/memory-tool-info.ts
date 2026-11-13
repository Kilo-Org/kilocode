// What the memory tool cards and permission prompts show: the query or text a `kilo_memory_recall` or
// `kilo_memory_save` call carries, and the user-facing summary of its result. The tool output is written for the
// model, so the cards read the stored texts out of it instead of showing it. Kept free of JSX and webview contexts,
// so the extension tests can load it.
export const MEMORY_RECALL = "kilo_memory_recall"
export const MEMORY_SAVE = "kilo_memory_save"

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/**
 * The subtitle of a memory tool card: the recall query, or the saved text or forgotten query. A model can copy the
 * stored `key :: text` form into its input, so only the text after ` :: ` is shown.
 */
export function memoryToolSubtitle(tool: string, input: Record<string, unknown>) {
  if (tool === MEMORY_RECALL) return text(input.query)
  if (tool !== MEMORY_SAVE) return ""
  const value = text(input.text) || text(input.query)
  const split = value.indexOf(" :: ")
  return split >= 0 ? value.slice(split + 4).trim() : value
}

/** The source files a memory tool result names. */
export function memoryToolSources(metadata: Record<string, unknown>) {
  return Array.isArray(metadata.sources)
    ? metadata.sources.filter((item): item is string => typeof item === "string")
    : []
}

/** The number of memories a finished recall returned, or undefined before it finished. */
export function memoryRecallCount(metadata: Record<string, unknown>) {
  return count(metadata.count)
}

/**
 * The memory texts a recall result lists: the stored text after ` :: ` of each `text:` record (the summary of a
 * session digest), and the value of each catalog row. Record headers, ids and markers are for the model only.
 */
export function memoryRecallItems(output: string) {
  return output.split("\n").flatMap((raw) => {
    const line = raw.trim()
    const record = line.startsWith("text: ")
    if (!record && !line.startsWith("- ")) return []
    const body = line.slice(record ? 6 : 2).trim()
    const split = body.indexOf(" :: ")
    if (split >= 0) return [body.slice(split + 4).trim()].filter(Boolean)
    if (record) return [body].filter(Boolean)
    // A catalog session row: `- session=<id> <topic> <date>`.
    const session = body.match(/^session=\S+\s+(.+)$/)
    return session ? [session[1].trim()] : []
  })
}

export type MemorySaveOutcome =
  | { kind: "saved" | "corrected"; count: number }
  | { kind: "removed"; count: number }
  | { kind: "unchanged" }

/** What a finished save did, or undefined when the result carries no counts (memory disabled, missing text). */
export function memorySaveOutcome(
  input: Record<string, unknown>,
  metadata: Record<string, unknown>,
): MemorySaveOutcome | undefined {
  const added = count(metadata.added)
  const removed = count(metadata.removed)
  if (added === undefined && removed === undefined) return undefined
  const action = text(input.action)
  if (action === "forget") return removed ? { kind: "removed", count: removed } : { kind: "unchanged" }
  if (!added) return { kind: "unchanged" }
  return { kind: action === "correct" ? "corrected" : "saved", count: added }
}

/** The translation key of a save action label, or undefined for an unknown action. */
export function memoryActionKey(input: Record<string, unknown>) {
  const action = text(input.action)
  if (action === "remember" || action === "correct" || action === "forget" || action === "skip")
    return `chat.memory.tool.action.${action}`
  return undefined
}

/**
 * The CLDR plural form of `base` for `count` in `locale` (a BCP 47 tag), falling back to `.other` when the
 * dictionary has no entry for that category.
 */
export function memoryPlural(
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: string,
  base: string,
  value: number,
) {
  const key = `${base}.${new Intl.PluralRules(locale).select(value)}`
  const found = t(key, { count: value })
  return found === key ? t(`${base}.other`, { count: value }) : found
}

/** The text a memory permission prompt shows: what would be saved or forgotten, or what is searched. */
export function memoryPermissionDetail(action: string, metadata: Record<string, unknown> | undefined) {
  if (action !== MEMORY_SAVE && action !== MEMORY_RECALL) return undefined
  return text(metadata?.text) || text(metadata?.query) || undefined
}
