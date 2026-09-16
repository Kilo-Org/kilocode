/**
 * Notice for leftover folders under `.kilo/worktrees/` that no git worktree claims.
 *
 * Deleting files is never automatic, so the only way these folders go away is this notice: it names
 * how many there are, shows their paths before anything is removed, and requires a second click.
 *
 * Not every orphan is empty. A `broken` one still holds a git checkout — an ex-worktree whose
 * registration is gone — so it can contain work that exists nowhere else. Those are marked in the
 * list and get a confirmation that says so, because reaching this notice takes two clicks from a
 * worktree row and the generic "nothing here is tracked by git" would be a false reassurance.
 */
import { Component, For, Show, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../src/context/language"
import type { OrphanDirectory } from "./project/store"

export const OrphanNotice: Component<{
  orphans: OrphanDirectory[]
  onClean: (paths: string[]) => void
}> = (props) => {
  const { t } = useLanguage()
  const [confirming, setConfirming] = createSignal(false)
  const checkouts = () => props.orphans.filter((orphan) => orphan.kind === "broken").length

  return (
    <Show when={props.orphans.length > 0}>
      <div class="am-orphan-notice" data-orphan-count={props.orphans.length}>
        <div class="am-orphan-notice-head">
          <Icon name="warning" size="small" />
          <span class="am-orphan-notice-title">{t("agentManager.orphans.title")}</span>
        </div>
        <div class="am-orphan-notice-body">{t("agentManager.orphans.summary", { count: props.orphans.length })}</div>
        <Show
          when={confirming()}
          fallback={
            <div class="am-orphan-notice-actions">
              <Button variant="ghost" size="small" onClick={() => setConfirming(true)}>
                {t("agentManager.orphans.clean")}
              </Button>
            </div>
          }
        >
          <ul class="am-orphan-notice-paths">
            <For each={props.orphans}>
              {(orphan) => (
                <li title={orphan.path} data-orphan-kind={orphan.kind}>
                  {orphan.path}
                  <Show when={orphan.kind === "broken"}>
                    <span class="am-orphan-notice-kind">{t("agentManager.orphans.checkout")}</span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <div class="am-orphan-notice-body">
            {checkouts() > 0
              ? t("agentManager.orphans.confirmCheckout", { count: checkouts() })
              : t("agentManager.orphans.confirm")}
          </div>
          <div class="am-orphan-notice-actions">
            <Button variant="ghost" size="small" onClick={() => setConfirming(false)}>
              {t("agentManager.orphans.cancel")}
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={() => {
                setConfirming(false)
                props.onClean(props.orphans.map((orphan) => orphan.path))
              }}
            >
              {t("agentManager.orphans.clean")}
            </Button>
          </div>
        </Show>
      </div>
    </Show>
  )
}
