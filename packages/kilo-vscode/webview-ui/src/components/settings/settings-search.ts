/**
 * Search for the Kilo Settings panel.
 *
 * Searchable settings are derived from the i18n `*.title` keys plus a small
 * group-to-tab map. Nested tabs, section headings, and rows rendered outside
 * their group's tab use explicit targets below.
 *
 * Ranking and highlighting stay free of Solid and DOM imports so they are
 * unit-testable.
 */

import { dict as en } from "../../i18n/en"
import { dict as agentManagerEn } from "../../../agent-manager/i18n/en"
import { createSettingsIndex, escapeRegExp, searchSettingsIndex } from "./settings-search-index"
export { createSettingsIndex, searchSettingsIndex }
export type { SettingsSearchIndex } from "./settings-search-index"

export interface SettingsTab {
  id: string
  titleKey: string
  keywords?: string[]
  /** Rendered only when the matching feature flag or host option is on. */
  conditional?: boolean
}

export interface SettingsNavigationTarget {
  /** Tab id that renders this setting. */
  tab: string
  /** Subtab id, when the setting is inside a nested tab. */
  subtab?: string
  /** i18n key of the row to reveal, if any. */
  titleKey?: string
}

export interface SettingsEntry extends SettingsNavigationTarget {
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
  "settings.experimental.browserAutomation.title": "browser",
  "settings.experimental.browserAutomation.systemChrome.title": "browser",
  "settings.experimental.browserLinks.title": "browser",
}

/** Agent Behaviour rows rendered without opening a separate editor or dialog. */
const AGENT_BEHAVIOUR_SUBTABS: Record<string, string> = {
  "settings.agentBehaviour.defaultAgent.title": "agents",
  "settings.agentBehaviour.sharedAgentBoard.title": "agents",
  "settings.agentBehaviour.claudeCompat.title": "rules",
  "settings.agentBehaviour.mcp.timeout.startup.title": "mcpServers",
  "settings.agentBehaviour.mcp.timeout.catalog.title": "mcpServers",
  "settings.agentBehaviour.mcp.timeout.execution.title": "mcpServers",
}

/** i18n `*.title` keys under a mapped group that are not rendered rows. */
const EXCLUDED_KEYS = new Set([
  "settings.permissions.toast.updateFailed.title",
  "settings.autoCleanup.defaultRetention.title",
  "settings.autoCleanup.enable.title",
  "settings.autoCleanup.lastRun.title",
  "settings.autoApprove.maxCost.title",
  "settings.webTools.webSearch.title",
  "settings.experimental.batch.title",
  "settings.experimental.claudeMigration.title",
  "settings.experimental.codeMode.title",
  "settings.experimental.continueOnDeny.title",
  "settings.experimental.globIncludeIgnored.title",
  "settings.experimental.imageGeneration.title",
  "settings.experimental.imageGenerationModel.title",
  "settings.experimental.mcpTimeout.title",
  "settings.experimental.remote.title",
  "settings.context.compaction.title",
  "settings.context.compactionLimit.title",
  "settings.context.prune.title",
  "settings.context.memory.title",
  "settings.context.memory.autoSave.title",
  "settings.context.memory.project.title",
  "settings.context.memory.storage.title",
  "agentManager.browser.title",
  // Models keys the v2 Models tab does not render: v2 has no subagent settings.
  "settings.providers.subagentModel.title",
])

/** Searchable rows whose title key does not end in `.title`, or that need a description override. */
const EXTRA_ENTRIES: SettingsEntry[] = [
  { tab: "agentBehaviour", subtab: "agents", titleKey: "settings.agentBehaviour.subtab.agents" },
  { tab: "agentBehaviour", subtab: "mcpServers", titleKey: "settings.agentBehaviour.subtab.mcpServers" },
  { tab: "agentBehaviour", subtab: "rules", titleKey: "settings.agentBehaviour.subtab.rules" },
  { tab: "agentBehaviour", subtab: "workflows", titleKey: "settings.agentBehaviour.subtab.workflows" },
  { tab: "agentBehaviour", subtab: "skills", titleKey: "settings.agentBehaviour.subtab.skills" },
  {
    tab: "agentBehaviour",
    subtab: "rules",
    titleKey: "settings.agentBehaviour.instructionFiles",
    descriptionKey: "settings.agentBehaviour.instructionFiles.description",
  },
  { tab: "agentBehaviour", subtab: "skills", titleKey: "settings.agentBehaviour.discoveredSkills" },
  { tab: "agentBehaviour", subtab: "skills", titleKey: "settings.agentBehaviour.skillPaths" },
  { tab: "agentBehaviour", subtab: "skills", titleKey: "settings.agentBehaviour.skillUrls" },
  { tab: "aboutKiloCode", titleKey: "settings.aboutKiloCode.versionInfo" },
  { tab: "aboutKiloCode", titleKey: "settings.aboutKiloCode.community" },
  { tab: "aboutKiloCode", titleKey: "settings.aboutKiloCode.cliServer", keywords: ["status", "connection"] },
  {
    tab: "autoApprove",
    titleKey: "settings.autoApprove.maxCost.title",
    descriptionKey: "settings.autoApprove.maxCost.v2Description",
  },
  {
    tab: "browser",
    titleKey: "settings.webTools.webSearch.enable",
    descriptionKey: "settings.webTools.webSearch.description",
  },
  { tab: "notifications", titleKey: "settings.notifications.sounds" },
  {
    tab: "commitMessage",
    titleKey: "settings.commitMessage.language.description",
    keywords: ["language", "locale"],
  },
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
    const subtab = AGENT_BEHAVIOUR_SUBTABS[key]
    if (tab === "agentBehaviour" && !subtab) continue
    seen.add(key)
    entries.push({ tab, titleKey: key, ...(subtab ? { subtab } : {}) })
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

export interface SettingsSearchResult extends SettingsNavigationTarget {
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

export function searchSettings(
  query: string,
  translate: Translate,
  entries: SettingsEntry[] = SETTINGS_ENTRIES,
  tabs: SettingsTab[] = SETTINGS_TABS,
): SettingsSearchResult[] {
  return searchSettingsIndex(createSettingsIndex(entries, tabs, translate), query)
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
