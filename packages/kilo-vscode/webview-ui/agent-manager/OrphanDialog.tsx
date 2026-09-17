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

/**
 * Header explanation, mirroring the JetBrains dialog's banner: the list comes from a heuristic over a
 * directory Kilo owns, and "delete 48 folders" is not a decision anybody can make from paths alone.
 *
 * Rendered inside the shared dialog's description slot, which is a `<p>`, so every block here is a
 * span laid out by CSS rather than a `<ul>`. The three bullets are the collapsible detail — the intro
 * sentence always stays visible, so collapsing never hides the point of the dialog, only the specifics.
 */
export const OrphanHelp: Component<{ expanded: boolean; onToggle: () => void }> = (props) => {
  const { t } = useLanguage()
  return (
    <>
      {t("agentManager.orphans.helpIntro")}
      <Show when={props.expanded}>
        <span class="am-orphan-help-list">
          <span>{t("agentManager.orphans.helpCheckout")}</span>
          <span>{t("agentManager.orphans.helpCauses")}</span>
          <span>{t("agentManager.orphans.helpDelete")}</span>
        </span>
      </Show>
      <button type="button" class="am-orphan-help-toggle" aria-expanded={props.expanded} onClick={props.onToggle}>
        {props.expanded ? t("agentManager.orphans.helpLess") : t("agentManager.orphans.helpMore")}
      </button>
    </>
  )
}

interface OrphanDialogProps {
  orphans: OrphanDirectory[]
  onReveal: (path: string) => void
  onDelete: (paths: string[]) => void
  onClose: () => void
}

export const OrphanDialog: Component<OrphanDialogProps> = (props) => {
  const { t } = useLanguage()
  const [helpExpanded, setHelpExpanded] = createSignal(false)
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
    <Dialog
      class="am-orphan-dialog-root"
      title={t("agentManager.orphans.dialogTitle")}
      description={<OrphanHelp expanded={helpExpanded()} onToggle={() => setHelpExpanded((prev) => !prev)} />}
      size="large"
    >
      <div class="am-orphan-dialog">
        <div class="am-orphan-scroll">
          <table class="am-orphan-table">
            <thead>
              <tr>
                <th class="am-orphan-col-check">
                  <Checkbox
                    hideLabel
                    checked={allChecked()}
                    indeterminate={someChecked()}
                    onChange={toggleAll}
                    icon={<Icon name={someChecked() ? "dash" : "check-small"} size="small" />}
                  >
                    {t("agentManager.orphans.dialogTitle")}
                  </Checkbox>
                </th>
                <th class="am-orphan-col-path">{t("agentManager.orphans.columnPath")}</th>
                <th class="am-orphan-col-size">{t("agentManager.orphans.columnSize")}</th>
                <th class="am-orphan-col-contents">{t("agentManager.orphans.columnContents")}</th>
                <th class="am-orphan-col-reveal" />
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
                        icon={<Icon name="check-small" size="small" />}
                      >
                        {orphan.path}
                      </Checkbox>
                    </td>
                    <td class="am-orphan-col-path">
                      <span class="am-orphan-path" title={orphan.path}>
                        {orphan.path}
                      </span>
                    </td>
                    <td class="am-orphan-col-size">
                      <Show when={orphan.bytes !== undefined} fallback={t("agentManager.orphans.calculating")}>
                        {formatOrphanBytes(orphan.bytes ?? 0)}
                      </Show>
                    </td>
                    <td class="am-orphan-col-contents">
                      <Show when={orphan.kind === "broken"}>
                        <span class="am-orphan-contents">
                          <Icon name="warning" size="small" />
                          <span>{t("agentManager.orphans.checkoutWarning")}</span>
                        </span>
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
        </div>

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
            <Button variant="secondary" size="normal" onClick={props.onClose}>
              {t("agentManager.orphans.cancel")}
            </Button>
            <Button
              variant="primary"
              size="normal"
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
