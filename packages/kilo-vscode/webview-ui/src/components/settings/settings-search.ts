/**
 * Search for the Kilo Settings panel.
 *
 * Searchable settings are derived from the i18n `*.title` keys plus a small
 * group-to-tab map, so there is no hand-maintained list to keep in sync. Adding
 * a `settings.<group>...title` key that maps to a tab makes that setting
 * searchable automatically; removing the key removes it. Only the rows whose
 * title key does not end in `.title`, and the two model rows rendered outside
 * their group's tab, need an explicit override below.
 *
 * Ranking and highlighting stay free of Solid and DOM imports so they are
 * unit-testable.
 */

import { dict as en } from "../../i18n/en"
import { dict as agentManagerEn } from "../../../agent-manager/i18n/en"

export interface SettingsTab {
  id: string
  titleKey: string
  keywords?: string[]
  /** Rendered only when the matching feature flag or host option is on. */
  conditional?: boolean
}

export interface SettingsEntry {
  /** Tab id that renders this setting. */
  tab: string
  /** i18n key of the setting title, also used to locate the row. */
  titleKey: string
  /** Optional override when the description key is not `<titleKey>.description`. */
  descriptionKey?: string
  keywords?: string[]
}

/** Tabs in the order they appear in the settings rail. */
export const SETTINGS_TABS: SettingsTab[] = [
  { id: "models", titleKey: "settings.models.title", keywords: ["model", "llm", "default", "speech"] },
  { id: "providers", titleKey: "settings.providers.title", keywords: ["provider", "api key", "connect", "auth"] },
  { id: "agentBehaviour", titleKey: "settings.agentBehaviour.title", keywords: ["agent", "mode", "mcp", "skill"] },
  { id: "autoApprove", titleKey: "settings.autoApprove.title", keywords: ["permission", "approve", "cost"] },
  {
    id: "agentManager",
    titleKey: "agentManager.settings.title",
    keywords: ["worktree", "branch", "git"],
    conditional: true,
  },
  { id: "browser", titleKey: "settings.webTools.title", keywords: ["browser", "web", "chrome", "playwright"] },
  { id: "checkpoints", titleKey: "settings.checkpoints.title", keywords: ["checkpoint", "undo", "cleanup"] },
  { id: "display", titleKey: "settings.display.title", keywords: ["display", "ui", "font", "theme"] },
  { id: "autocomplete", titleKey: "settings.autocomplete.title", keywords: ["completion", "inline", "suggest"] },
  { id: "notifications", titleKey: "settings.notifications.title", keywords: ["notification", "sound", "alert"] },
  { id: "context", titleKey: "settings.context.title", keywords: ["memory", "compaction", "prune"] },
  { id: "commitMessage", titleKey: "settings.commitMessage.title", keywords: ["commit", "git", "message"] },
  {
    id: "indexing",
    titleKey: "settings.indexing.title",
    keywords: ["embeddings", "vector", "codebase"],
    conditional: true,
  },
  { id: "experimental", titleKey: "settings.experimental.title", keywords: ["beta", "flag", "preview"] },
  {
    id: "sandboxing",
    titleKey: "settings.sandboxing.title",
    keywords: ["sandbox", "security", "network"],
    conditional: true,
  },
  { id: "language", titleKey: "settings.language.title", keywords: ["locale", "translation"] },
  { id: "aboutKiloCode", titleKey: "settings.aboutKiloCode.title", keywords: ["version", "update", "support"] },
]

/**
 * i18n group (the segment after `settings.`) to the tab that renders it.
 * Groups not listed here are not searchable, which keeps dialog-only keys out.
 */
const GROUP_TABS: Record<string, string> = {
  aboutKiloCode: "aboutKiloCode",
  agentBehaviour: "agentBehaviour",
  autoApprove: "autoApprove",
  autoCleanup: "checkpoints",
  autocomplete: "autocomplete",
  browser: "browser",
  checkpoints: "checkpoints",
  commitMessage: "commitMessage",
  context: "context",
  display: "display",
  experimental: "experimental",
  indexing: "indexing",
  language: "language",
  models: "models",
  notifications: "notifications",
  permissions: "autoApprove",
  providers: "models",
  sandboxing: "sandboxing",
  webTools: "browser",
}

/** Rows whose group tab differs from the tab that actually renders them. */
const KEY_TAB_OVERRIDES: Record<string, string> = {
  "settings.context.compactionModel.title": "models",
  "settings.autocomplete.model.title": "models",
}

/** i18n `*.title` keys under a mapped group that are not rendered rows. */
const EXCLUDED_KEYS = new Set([
  "settings.permissions.toast.updateFailed.title",
  "settings.autoCleanup.defaultRetention.title",
  "settings.webTools.webSearch.title",
  "agentManager.browser.title",
])

/** Searchable rows whose title key does not end in `.title`, or that need a description override. */
const EXTRA_ENTRIES: SettingsEntry[] = [
  {
    tab: "browser",
    titleKey: "settings.webTools.webSearch.enable",
    descriptionKey: "settings.webTools.webSearch.description",
  },
  { tab: "notifications", titleKey: "settings.notifications.sounds" },
  {
    tab: "agentManager",
    titleKey: "agentManager.worktree.defaultBaseBranch",
    descriptionKey: "agentManager.settings.defaultBaseBranch.description",
  },
  {
    tab: "agentManager",
    titleKey: "agentManager.worktree.setupScript",
    descriptionKey: "agentManager.settings.setupScript.description",
  },
]

const TITLE_KEY = /^(settings|agentManager)\.[a-z0-9_.]+\.title$/i

function tabForKey(key: string): string | undefined {
  const override = KEY_TAB_OVERRIDES[key]
  if (override) return override
  if (key.startsWith("agentManager.")) return key.startsWith("agentManager.settings.") ? "agentManager" : undefined
  return GROUP_TABS[key.split(".")[1] ?? ""]
}

/** Build the search entries from the i18n key set. */
export function deriveSettingsEntries(keys: Iterable<string>): SettingsEntry[] {
  const tabTitles = new Set(SETTINGS_TABS.map((tab) => tab.titleKey))
  const seen = new Set<string>()
  const entries: SettingsEntry[] = []
  for (const key of keys) {
    if (!TITLE_KEY.test(key) || seen.has(key) || EXCLUDED_KEYS.has(key) || tabTitles.has(key)) continue
    const tab = tabForKey(key)
    if (!tab) continue
    seen.add(key)
    entries.push({ tab, titleKey: key })
  }
  for (const entry of EXTRA_ENTRIES) {
    if (seen.has(entry.titleKey)) continue
    seen.add(entry.titleKey)
    entries.push(entry)
  }
  return entries
}

export const SETTINGS_ENTRIES: SettingsEntry[] = deriveSettingsEntries([
  ...Object.keys(en),
  ...Object.keys(agentManagerEn),
])

export interface SettingsSearchResult {
  /** Tab id to open. */
  tab: string
  /** i18n key of the matched title. */
  titleKey: string
  /** i18n key of the matched description, when the entry has one. */
  descriptionKey?: string
  /** Translated title, ready for display and for `data-search-label` matching. */
  title: string
  /** Translated description, or undefined when missing. */
  description?: string
  /** Lower score sorts later. */
  score: number
  /** True for tab-only entries that open the tab without a target row. */
  tabOnly: boolean
}

type Translate = (key: string) => string

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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
 *
 * The index is small (about 120 entries), so this runs synchronously on every
 * keystroke. Regexes and translations are computed once per call to keep it
 * well under a frame.
 */
export function searchSettings(
  query: string,
  translate: Translate,
  entries: SettingsEntry[] = SETTINGS_ENTRIES,
  tabs: SettingsTab[] = SETTINGS_TABS,
): SettingsSearchResult[] {
  const tokens: QueryToken[] = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, word: new RegExp(`\\b${escapeRegExp(raw)}`) }))
  if (tokens.length === 0) return []

  const tabLabels = new Map<string, string>()
  for (const tab of tabs) tabLabels.set(tab.id, translate(tab.titleKey).toLowerCase())

  const results: SettingsSearchResult[] = []

  for (const entry of entries) {
    const tab = entry.tab
    if (!tabLabels.has(tab)) continue
    const titleRaw = translate(entry.titleKey)
    const title = titleRaw.toLowerCase()
    const descriptionKey = descriptionKeyFor(entry)
    const descriptionRaw = readDescription(descriptionKey, translate)
    const description = (descriptionRaw ?? "").toLowerCase()
    const keywords = (entry.keywords ?? []).join(" ").toLowerCase()
    const tabLabel = tabLabels.get(tab) ?? ""
    const haystack = `${title} ${keywords} ${description} ${tabLabel}`
    const matched = tokens.every((token) => haystack.includes(token.raw))
    if (!matched) continue
    const score = tokens.reduce((sum, token) => sum + scoreToken(token, title, keywords, description, tabLabel), 0)
    results.push({
      tab,
      titleKey: entry.titleKey,
      descriptionKey: descriptionKey || undefined,
      title: titleRaw,
      description: descriptionRaw,
      score,
      tabOnly: false,
    })
  }

  const seen = new Set(results.map((result) => result.tab))
  for (const tab of tabs) {
    const label = translate(tab.titleKey)
    const lower = label.toLowerCase()
    const keywords = (tab.keywords ?? []).join(" ").toLowerCase()
    const matched = tokens.every((token) => lower.includes(token.raw) || keywords.includes(token.raw))
    if (!matched) continue
    if (seen.has(tab.id)) {
      const existing = results.find((result) => result.tab === tab.id)
      if (existing) existing.score += 5
      continue
    }
    results.push({
      tab: tab.id,
      titleKey: tab.titleKey,
      title: label,
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

export interface SearchSegment {
  text: string
  match: boolean
}

export type Highlighter = (text: string) => SearchSegment[]

/**
 * Build a reusable highlighter for one query. The matching regex is compiled
 * once and shared across every rendered row, which keeps large result sets
 * cheap to render.
 */
export function createHighlighter(query: string): Highlighter {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return (text) => [{ text, match: false }]
  const pattern = new RegExp(`(${tokens.map((token) => escapeRegExp(token)).join("|")})`, "gi")
  return (text) =>
    text
      .split(pattern)
      .filter((part) => part.length > 0)
      .map((part) => ({ text: part, match: tokens.includes(part.toLowerCase()) }))
}

/** Split `text` into plain and query-matched segments for highlighting. */
export function highlightSegments(text: string, query: string): SearchSegment[] {
  return createHighlighter(query)(text)
}
