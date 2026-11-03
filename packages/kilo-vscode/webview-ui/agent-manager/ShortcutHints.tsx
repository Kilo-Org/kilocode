import { For, Show } from "solid-js"
import { useLanguage } from "../src/context/language"
import { ShortcutKeys } from "../src/components/shared/ShortcutKeys"
import { hintRows } from "./shortcut-hints"
import { LOCAL, type NavEntry } from "./navigate"
import { kiloSettings } from "../src/v2/kilo-settings"

type Stats = { files: number; additions: number; deletions: number }

/** The shortcut list of the empty session view. */
export function createShortcutHints(opts: {
  kb: () => Record<string, string>
  selection: () => string | null
  registry: { active: () => { localStats: () => Stats | undefined; worktreeStats: () => Record<string, Stats> } }
  activePR: () => unknown
  /** Sidebar items in jump order, matching the numeric shortcut badges. */
  nav: () => NavEntry[]
}) {
  const { t } = useLanguage()
  // `kilo-code.v2.showShortcutHints`, on by default.
  const on = () => kiloSettings()["showShortcutHints"] !== false

  const stats = () => {
    const project = opts.registry.active()
    return opts.selection() === LOCAL ? project.localStats() : project.worktreeStats()[opts.selection() ?? ""]
  }
  const worktrees = () => opts.nav().filter((entry) => entry.target.kind === "worktree").length
  const rows = () => hintRows(opts.kb(), { stats: stats(), pr: !!opts.activePR(), worktrees: worktrees() })

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

  return { list }
}
