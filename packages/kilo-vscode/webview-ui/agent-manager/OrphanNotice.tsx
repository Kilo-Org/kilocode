/**
 * Notice for leftover folders under `.kilo/worktrees/` that no git worktree claims.
 *
 * Deleting files is never automatic, so the only way these folders go away is this notice: it names
 * how many there are, shows their paths before anything is removed, and requires a second click.
 */
import { Component, For, Show, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../src/context/language"

export const OrphanNotice: Component<{
  paths: string[]
  onClean: (paths: string[]) => void
}> = (props) => {
  const { t } = useLanguage()
  const [confirming, setConfirming] = createSignal(false)

  return (
    <Show when={props.paths.length > 0}>
      <div class="am-orphan-notice" data-orphan-count={props.paths.length}>
        <div class="am-orphan-notice-head">
          <Icon name="warning" size="small" />
          <span class="am-orphan-notice-title">{t("agentManager.orphans.title")}</span>
        </div>
        <div class="am-orphan-notice-body">{t("agentManager.orphans.summary", { count: props.paths.length })}</div>
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
            <For each={props.paths}>{(path) => <li title={path}>{path}</li>}</For>
          </ul>
          <div class="am-orphan-notice-body">{t("agentManager.orphans.confirm")}</div>
          <div class="am-orphan-notice-actions">
            <Button variant="ghost" size="small" onClick={() => setConfirming(false)}>
              {t("agentManager.orphans.cancel")}
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={() => {
                setConfirming(false)
                props.onClean(props.paths)
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
