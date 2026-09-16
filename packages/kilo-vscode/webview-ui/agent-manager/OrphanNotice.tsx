/**
 * Warning banner for leftover folders under `.kilo/worktrees/` that no git worktree claims.
 *
 * Deleting files is never automatic, so the only action here is opening `OrphanDialog` — the banner
 * itself only ever names how many there are and their total size. Size is asynchronous (a background
 * fs walk), so it is shown once every orphan's size has landed and a calculating affordance is shown
 * until then rather than a wrong or stale number.
 */
import { Component, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../src/context/language"
import { formatOrphanBytes, orphanTotalBytes } from "./orphan-dialog-logic"
import type { OrphanDirectory } from "./project/store"

export const OrphanNotice: Component<{
  orphans: OrphanDirectory[]
  onResolve: () => void
}> = (props) => {
  const { t } = useLanguage()
  const total = () => orphanTotalBytes(props.orphans)

  return (
    <Show when={props.orphans.length > 0}>
      <div class="am-orphan-notice" data-orphan-count={props.orphans.length}>
        <div class="am-orphan-notice-head">
          <Icon name="warning" size="small" />
          <span class="am-orphan-notice-title">
            <Show
              when={total() !== undefined}
              fallback={t("agentManager.orphans.summaryCount", { count: props.orphans.length })}
            >
              {t("agentManager.orphans.summarySize", {
                count: props.orphans.length,
                size: formatOrphanBytes(total() ?? 0),
              })}
            </Show>
          </span>
          <Show when={total() === undefined}>
            <span class="am-orphan-notice-calculating">{t("agentManager.orphans.calculating")}</span>
          </Show>
        </div>
        <div class="am-orphan-notice-actions">
          <Button variant="ghost" size="small" onClick={props.onResolve}>
            {t("agentManager.orphans.resolve")}
          </Button>
        </div>
      </div>
    </Show>
  )
}
