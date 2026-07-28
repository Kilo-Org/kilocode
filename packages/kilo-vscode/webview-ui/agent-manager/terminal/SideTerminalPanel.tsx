/**
 * Right-side terminal panel for the Agent Manager inspector.
 *
 * Lives inside the shared `.am-diff-panel-wrapper` host next to the diff
 * and PR panels, so all three inspector modes share one resize handle
 * and one width. The header intentionally reuses the `.am-diff-header`
 * structure and metrics so switching modes does not shift the chrome.
 *
 * Visibility is opacity-based, never unmount: the xterm render loop
 * dies when its subtree leaves the paint tree (see `render.tsx`).
 */

import type { Accessor, Component } from "solid-js"
import { Show, createEffect } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Button } from "@kilocode/kilo-ui/button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../src/context/language"
import { renderSideTerminalLayer } from "./render"
import type { TerminalStateControls } from "./state"

interface Props {
  state: TerminalStateControls
  /** Context the panel currently shows (`state.sideKey`). */
  contextKey: Accessor<string>
  /** True while the inspector is in terminal mode. */
  visible: Accessor<boolean>
  /** Kill the terminal (or cancel its create) and hide. */
  onClose: () => void
  /** Empty-state action: create a side terminal for this context. */
  onStart: () => void
}

export const SideTerminalPanel: Component<Props> = (props) => {
  const { t } = useLanguage()
  let panel!: HTMLElement
  createEffect(() => {
    panel.inert = !props.visible()
  })
  const side = () => props.state.side()
  const pending = () => props.state.pendingSide(props.contextKey()) !== undefined
  return (
    <section
      ref={panel}
      class={`am-side-terminal ${props.visible() ? "am-side-terminal-visible" : ""}`}
      aria-label={t("agentManager.tab.terminal")}
      aria-hidden={!props.visible()}
    >
      <div class="am-diff-header">
        <div class="am-diff-header-main">
          <Icon name="console" size="small" />
          <span class="am-diff-header-title">{side()?.title ?? t("agentManager.tab.terminal")}</span>
        </div>
        <div class="am-diff-header-actions">
          <Tooltip value={t("agentManager.terminal.kill")} placement="bottom">
            <IconButton
              icon="trash"
              size="small"
              variant="ghost"
              aria-label={t("agentManager.terminal.kill")}
              onClick={props.onClose}
            />
          </Tooltip>
        </div>
      </div>
      {renderSideTerminalLayer({ state: props.state, contextKey: props.contextKey, visible: props.visible })}
      <Show when={props.visible() && pending() && !side()}>
        <div class="am-side-terminal-state" role="status">
          <Spinner />
          <span>{t("common.loading")}</span>
        </div>
      </Show>
      <Show when={props.visible() && !pending() && !side()}>
        <div class="am-side-terminal-state">
          <span class="am-side-terminal-empty">{t("agentManager.terminal.empty")}</span>
          <Button variant="primary" size="small" onClick={props.onStart}>
            {t("agentManager.terminal.start")}
          </Button>
        </div>
      </Show>
    </section>
  )
}
