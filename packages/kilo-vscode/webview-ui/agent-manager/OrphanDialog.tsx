/**
 * Table dialog for resolving leftover folders under `.kilo/worktrees/`.
 *
 * Opened from the `Resolve…` banner action. `leftover` rows (no `.git`, nothing tracked) are
 * pre-selected; `broken` rows (still hold a git checkout) start unchecked and flagged, since their
 * files can exist nowhere else. Deletion itself runs in the background after this dialog closes —
 * see `worktree-recovery.ts` — so this component only ever collects a selection and hands it off.
 */
import { Component, For, Show, createSignal } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { useLanguage } from "../src/context/language"
import { defaultOrphanSelection, formatOrphanBytes, orphanSelectionStats, revealPlatform } from "./orphan-dialog-logic"
import type { OrphanDirectory } from "./project/store"

const REVEAL_KEYS = {
  mac: "agentManager.orphans.revealMac",
  windows: "agentManager.orphans.revealWindows",
  linux: "agentManager.orphans.revealLinux",
} as const

/** OS-specific label, or the generic fallback when `navigator` cannot be read (e.g. SSR/tests). */
function revealLabelKey(userAgent: string | undefined): string {
  if (userAgent === undefined) return "agentManager.orphans.reveal"
  return REVEAL_KEYS[revealPlatform(userAgent)]
}

interface OrphanDialogProps {
  orphans: OrphanDirectory[]
  onReveal: (path: string) => void
  onDelete: (paths: string[]) => void
  onClose: () => void
}

export const OrphanDialog: Component<OrphanDialogProps> = (props) => {
  const { t } = useLanguage()
  const [selected, setSelected] = createSignal(defaultOrphanSelection(props.orphans))
  const stats = () => orphanSelectionStats(props.orphans, selected())
  const allChecked = () => props.orphans.length > 0 && props.orphans.every((orphan) => selected().has(orphan.path))
  const someChecked = () => !allChecked() && props.orphans.some((orphan) => selected().has(orphan.path))
  const revealKey = revealLabelKey(typeof navigator !== "undefined" ? navigator.userAgent : undefined)

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(props.orphans.map((orphan) => orphan.path)) : new Set<string>())
  }
  const toggleRow = (path: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(path)
      else next.delete(path)
      return next
    })
  }

  return (
    <Dialog title={t("agentManager.orphans.dialogTitle")} size="large">
      <div class="am-orphan-dialog">
        <table class="am-orphan-table">
          <thead>
            <tr>
              <th class="am-orphan-col-check">
                <Checkbox hideLabel checked={allChecked()} indeterminate={someChecked()} onChange={toggleAll}>
                  {t("agentManager.orphans.dialogTitle")}
                </Checkbox>
              </th>
              <th>{t("agentManager.orphans.columnPath")}</th>
              <th>{t("agentManager.orphans.columnSize")}</th>
              <th>{t("agentManager.orphans.columnContents")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For each={props.orphans}>
              {(orphan) => (
                <tr data-orphan-kind={orphan.kind}>
                  <td class="am-orphan-col-check">
                    <Checkbox
                      hideLabel
                      checked={selected().has(orphan.path)}
                      onChange={(checked) => toggleRow(orphan.path, checked)}
                    >
                      {orphan.path}
                    </Checkbox>
                  </td>
                  <td class="am-orphan-path" title={orphan.path}>
                    {orphan.path}
                  </td>
                  <td class="am-orphan-size">
                    <Show when={orphan.bytes !== undefined} fallback={t("agentManager.orphans.calculating")}>
                      {formatOrphanBytes(orphan.bytes ?? 0)}
                    </Show>
                  </td>
                  <td class="am-orphan-contents">
                    <Show when={orphan.kind === "broken"}>
                      <Icon name="warning" size="small" />
                      <span>{t("agentManager.orphans.checkoutWarning")}</span>
                    </Show>
                  </td>
                  <td class="am-orphan-col-reveal">
                    <IconButton
                      icon="folder"
                      variant="ghost"
                      size="small"
                      aria-label={t(revealKey)}
                      title={t(revealKey)}
                      onClick={() => props.onReveal(orphan.path)}
                    />
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>

        <div class="am-orphan-dialog-footer">
          <div class="am-orphan-dialog-summary">
            <span>
              {t("agentManager.orphans.footerSelected", {
                count: stats().count,
                size:
                  stats().bytes !== undefined
                    ? formatOrphanBytes(stats().bytes ?? 0)
                    : t("agentManager.orphans.calculating"),
              })}
            </span>
            <Show when={stats().checkouts > 0}>
              <span class="am-orphan-dialog-checkouts">
                {t("agentManager.orphans.footerCheckouts", { count: stats().checkouts })}
              </span>
            </Show>
          </div>
          <div class="am-orphan-dialog-actions">
            <Button variant="ghost" size="large" onClick={props.onClose}>
              {t("agentManager.orphans.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              class="am-confirm-delete"
              disabled={stats().count === 0}
              onClick={() => props.onDelete([...selected()])}
            >
              {t("agentManager.orphans.deleteButton", {
                count: stats().count,
                size: stats().bytes !== undefined ? formatOrphanBytes(stats().bytes ?? 0) : "…",
              })}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}
