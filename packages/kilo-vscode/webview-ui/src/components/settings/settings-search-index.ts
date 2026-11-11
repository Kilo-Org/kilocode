import type { SettingsEntry, SettingsSearchResult, SettingsTab } from "./settings-search"

type Translate = (key: string) => string

interface IndexedEntry {
  tab: string
  subtab?: string
  titleKey: string
  descriptionKey?: string
  title: string
  description?: string
  titleLower: string
  keywords: string
  descriptionLower: string
  tabLabel: string
  haystack: string
}

interface IndexedTab {
  id: string
  titleKey: string
  title: string
  titleLower: string
  keywords: string
}

/**
 * The translated and lowercased rows search runs against. Building it once per
 * language and catalog keeps every keystroke free of translation lookups and
 * repeated string normalization.
 */
export interface SettingsSearchIndex {
  entries: IndexedEntry[]
  tabs: IndexedTab[]
}

function descriptionKeyFor(entry: SettingsEntry): string {
  if (entry.descriptionKey) return entry.descriptionKey
  return entry.titleKey.endsWith(".title") ? entry.titleKey.replace(/\.title$/, ".description") : ""
}

/** Resolve a description key, treating a missing translation as absent. */
function readDescription(key: string, translate: Translate): string | undefined {
  if (!key) return undefined
  const text = translate(key)
  return text === key ? undefined : text
}

interface QueryToken {
  raw: string
  word: RegExp
}

function scoreToken(token: QueryToken, title: string, keywords: string, description: string, tab: string): number {
  if (title === token.raw) return 120
  if (title.startsWith(token.raw)) return 70
  if (token.word.test(title)) return 50
  if (title.includes(token.raw)) return 30
  if (keywords.includes(token.raw)) return 20
  if (description.includes(token.raw)) return 10
  if (tab.includes(token.raw)) return 5
  return 0
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Translate and normalize the searchable rows once, before the user types. */
export function createSettingsIndex(
  entries: SettingsEntry[],
  tabs: SettingsTab[],
  translate: Translate,
): SettingsSearchIndex {
  const tabLabels = new Map<string, string>()
  for (const tab of tabs) tabLabels.set(tab.id, translate(tab.titleKey).toLowerCase())

  return {
    entries: entries.flatMap((entry) => {
      if (!tabLabels.has(entry.tab)) return []
      const descriptionKey = descriptionKeyFor(entry)
      const description = readDescription(descriptionKey, translate)
      const title = translate(entry.titleKey)
      const titleLower = title.toLowerCase()
      const keywords = (entry.keywords ?? []).join(" ").toLowerCase()
      const descriptionLower = (description ?? "").toLowerCase()
      const tabLabel = tabLabels.get(entry.tab) ?? ""
      return [
        {
          tab: entry.tab,
          ...(entry.subtab ? { subtab: entry.subtab } : {}),
          titleKey: entry.titleKey,
          descriptionKey: descriptionKey || undefined,
          title,
          description,
          titleLower,
          keywords,
          descriptionLower,
          tabLabel,
          haystack: `${titleLower} ${keywords} ${descriptionLower} ${tabLabel}`,
        },
      ]
    }),
    tabs: tabs.map((tab) => {
      const title = translate(tab.titleKey)
      return {
        id: tab.id,
        titleKey: tab.titleKey,
        title,
        titleLower: title.toLowerCase(),
        keywords: (tab.keywords ?? []).join(" ").toLowerCase(),
      }
    }),
  }
}

/**
 * Rank settings and tabs against a free-text query.
 *
 * Every whitespace-separated token must match somewhere (title, keywords,
 * description, or tab name). Token matches in the title score highest so the
 * most relevant settings float to the top. An empty query returns no results.
 *
 * Results are grouped by the tab that owns them, in order of that tab's best
 * match, and stay score-ordered within each group. The grouped list is what the
 * results pane renders, and keyboard selection indexes into this array, so a
 * tab must stay contiguous or Enter could open a different setting than the
 * highlighted one.
 */
export function searchSettingsIndex(index: SettingsSearchIndex, query: string): SettingsSearchResult[] {
  const tokens: QueryToken[] = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, word: new RegExp(`\\b${escapeRegExp(raw)}`) }))
  if (tokens.length === 0) return []

  const results: SettingsSearchResult[] = []

  for (const entry of index.entries) {
    const matched = tokens.every((token) => entry.haystack.includes(token.raw))
    if (!matched) continue
    const score = tokens.reduce(
      (sum, token) =>
        sum + scoreToken(token, entry.titleLower, entry.keywords, entry.descriptionLower, entry.tabLabel),
      0,
    )
    results.push({
      tab: entry.tab,
      ...(entry.subtab ? { subtab: entry.subtab } : {}),
      titleKey: entry.titleKey,
      descriptionKey: entry.descriptionKey,
      title: entry.title,
      description: entry.description,
      score,
      tabOnly: false,
    })
  }

  const seen = new Set(results.map((result) => result.tab))
  for (const tab of index.tabs) {
    const matched = tokens.every((token) => tab.titleLower.includes(token.raw) || tab.keywords.includes(token.raw))
    if (!matched) continue
    if (seen.has(tab.id)) {
      const existing = results.find((result) => result.tab === tab.id)
      if (existing) existing.score += 5
      continue
    }
    results.push({
      tab: tab.id,
      titleKey: tab.titleKey,
      title: tab.title,
      score: tokens.length * 5,
      tabOnly: true,
    })
  }

  const sorted = results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))

  const grouped = new Map<string, SettingsSearchResult[]>()
  for (const result of sorted) {
    const list = grouped.get(result.tab)
    if (list) list.push(result)
    else grouped.set(result.tab, [result])
  }
  return [...grouped.values()].flat()
}
