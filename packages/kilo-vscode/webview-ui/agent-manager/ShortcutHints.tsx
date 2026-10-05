import { For, Show, type JSX } from "solid-js"
import { useConfig } from "../src/context/config"
import { useLanguage } from "../src/context/language"
import type { ManagerContext } from "../src/utils/shortcut-hint"
import { parseBindingTokens } from "../src/utils/keybind-tokens"
import { hintRows } from "./shortcut-hints"
import { SidePanel } from "./side-panel-layout"
import { LOCAL, type NavEntry } from "./navigate"

type Stats = { files: number; additions: number; deletions: number }
type Activity = { project: (projectId: string, worktree: string | null) => string }

const keys = (binding: string): JSX.Element => (
  <span class="am-hint-keys">
    <For each={parseBindingTokens(binding)}>{(token) => <kbd class="am-hint-kbd">{token}</kbd>}</For>
  </span>
)

/** Agent Manager input for the prompt shortcut hint, and the empty session list. */
export function createShortcutHints(opts: {
  kb: () => Record<string, string>
  selection: () => string | null
  registry: { active: () => { localStats: () => Stats | undefined; worktreeStats: () => Record<string, Stats> } }
  activePR: () => unknown
  sidePanel: () => SidePanel | null | undefined
  /** Sidebar items in jump order, matching the numeric shortcut badges. */
  nav: () => NavEntry[]
  activeProjectId: () => string | undefined
  activity: Activity
}) {
  const config = useConfig()
  const { t } = useLanguage()
  const on = () => config.settings().showShortcutHints !== false

  const stats = () => {
    const project = opts.registry.active()
    return opts.selection() === LOCAL ? project.localStats() : project.worktreeStats()[opts.selection() ?? ""]
  }
  const changes = () => {
    const s = stats()
    return !!s && (s.files > 0 || s.additions > 0 || s.deletions > 0)
  }
  const worktrees = () => opts.nav().filter((entry) => entry.target.kind === "worktree").length
  const selected = (entry: NavEntry) => {
    const target = entry.target
    if (target.projectId !== opts.activeProjectId()) return false
    if (target.kind === "local") return opts.selection() === LOCAL
    if (target.kind === "worktree") return opts.selection() === target.worktreeId
    return false
  }
  const activityOf = (entry: NavEntry) =>
    opts.activity.project(entry.target.projectId, entry.target.kind === "worktree" ? entry.target.worktreeId : null)

  const manager = (): ManagerContext => {
    const panel = opts.sidePanel()
    const index = opts.nav().findIndex((entry) => !selected(entry) && activityOf(entry) === "waiting")
    return {
      changes: changes(),
      pr: !!opts.activePR(),
      panel: panel === SidePanel.Diff ? "diff" : panel === SidePanel.PR ? "pr" : panel ? "other" : undefined,
      worktrees: worktrees(),
      waiting: index >= 0 && index < 9 ? index + 1 : undefined,
    }
  }

  const rows = () => hintRows(opts.kb(), { stats: stats(), pr: !!opts.activePR(), worktrees: worktrees() })

  const list = () => (
    <Show when={on() && rows().length > 0}>
      <div class="am-hint-list">
        <For each={rows()}>
          {(row) => (
            <>
              <span class="am-hint-label">{t(row.label)}</span>
              <span class="am-hint-keys">
                <For each={row.bindings}>{(binding) => keys(binding)}</For>
              </span>
            </>
          )}
        </For>
      </div>
    </Show>
  )

  return { manager, list }
}
