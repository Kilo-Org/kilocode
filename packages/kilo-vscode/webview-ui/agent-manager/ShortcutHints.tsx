import { For, Show } from "solid-js"
import { useLanguage } from "../src/context/language"
import { ShortcutKeys } from "../src/components/shared/ShortcutKeys"
import type { ManagerContext } from "../src/v2/shortcut-hint"
import { kiloSettings } from "../src/v2/kilo-settings"
import type { Activity } from "./v2/activity"
import { hintManager, hintRows } from "./shortcut-hints"
import { LOCAL, type NavEntry } from "./navigate"
import { SidePanel } from "./side-panel-layout"

type Stats = { files: number; additions: number; deletions: number }

/** Agent Manager input for the prompt shortcut hint, and the shortcut list of the empty session view. */
export function createShortcutHints(opts: {
  kb: () => Record<string, string>
  selection: () => string | null
  registry: { active: () => { localStats: () => Stats | undefined; worktreeStats: () => Record<string, Stats> } }
  activePR: () => unknown
  sidePanel: () => SidePanel | null | undefined
  /** Sidebar items in jump order, matching the numeric shortcut badges. */
  nav: () => NavEntry[]
  activeProjectId: () => string | undefined
  activity: { project: (projectId: string, worktree: string | null) => Activity }
}) {
  const { t } = useLanguage()
  // `kilo-code.v2.showShortcutHints`, on by default.
  const on = () => kiloSettings()["showShortcutHints"] !== false

  const stats = () => {
    const project = opts.registry.active()
    return opts.selection() === LOCAL ? project.localStats() : project.worktreeStats()[opts.selection() ?? ""]
  }
  const worktrees = () => opts.nav().filter((entry) => entry.target.kind === "worktree").length
  const changes = () => {
    const value = stats()
    return !!value && (value.files > 0 || value.additions > 0 || value.deletions > 0)
  }

  const manager = (): ManagerContext =>
    hintManager({
      nav: opts.nav(),
      selection: opts.selection(),
      activeProjectId: opts.activeProjectId(),
      activity: opts.activity.project,
      changes: changes(),
      pr: !!opts.activePR(),
      panel: opts.sidePanel(),
    })

  const rows = () =>
    hintRows(opts.kb(), {
      stats: stats(),
      pr: !!opts.activePR(),
      worktrees: worktrees(),
      worktree: opts.selection() !== null && opts.selection() !== LOCAL,
    })

  const list = () => (
    <Show when={on() && rows().length > 0}>
      <div class="am-hint-list">
        <For each={rows()}>
          {(row) => (
            <>
              <span class="am-hint-label">{t(row.label)}</span>
              <ShortcutKeys binding={row.bindings.join(" ")} />
            </>
          )}
        </For>
      </div>
    </Show>
  )

  return { manager, list }
}
