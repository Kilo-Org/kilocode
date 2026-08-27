/**
 * Right-side terminal panel for the Agent Manager inspector.
 *
 * Lives inside the shared inspector host next to diff, PR, and subagent
 * panels, so every mode uses the same persisted resize width. The tab row is
 * the shared inspector strip used by subagents as well.
 *
 * Hidden slots are translated off-screen while keeping their layout
 * box, never unmounted: xterm keeps its buffer, socket, and parser
 * alive, while xterm's own render observer (IntersectionObserver on the
 * screen element) pauses the render loop for hidden slots and replays a
 * full refresh when a slot becomes visible again. Keeping the box means
 * FitAddon can measure the panel (correct wrapping) even while hidden.
 * `TerminalTab` still does an explicit fit + refresh on activation as
 * insurance (see `render.tsx`).
 */

import type { Accessor, Component } from "solid-js"
import { Show, createEffect } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../src/context/language"
import { InspectorTabStrip } from "../InspectorTabStrip"
import { renderSideTerminalLayer } from "./render"
import { SortableTerminalTab } from "./SortableTerminalTab"
import type { TerminalStateControls } from "./state"

interface Props {
  state: TerminalStateControls
  /** Context the panel currently shows (`state.sideKey`). */
  contextKey: Accessor<string>
  /** True while the inspector is in terminal mode. */
  visible: Accessor<boolean>
  /** Make a terminal the visible one in the strip. */
  onSelect: (terminalId: string) => void
  /** Kill one terminal. */
  onClose: (terminalId: string) => void
  /** Kill every terminal of this context except the given one. */
  onCloseOthers: (terminalId: string) => void
  /** Create a new side terminal for this context. */
  onStart: () => void
  nextKeybind: string
  closeKeybind: string
  /** Deliberately stop a running script terminal. */
  onStop: (terminalId: string) => void
  onFocusPrompt: () => void
  onFocusChange?: (focused: boolean) => void
}

export const SideTerminalPanel: Component<Props> = (props) => {
  const { t } = useLanguage()
  let panel!: HTMLElement
  createEffect(() => {
    panel.inert = !props.visible()
  })
  const sides = () => props.state.sidesForContext(props.contextKey())
  const ids = () => sides().map((term) => term.id)
  const active = () => props.state.sideActiveFor(props.contextKey())
  const pending = () => props.state.pendingSide(props.contextKey())
  const close = (id: string, focus: { restore: () => void }) => {
    props.onClose(id)
    if (ids().length > 0) focus.restore()
  }

  return (
    <section
      ref={panel}
      class={`am-side-terminal ${props.visible() ? "am-side-terminal-visible" : ""}`}
      aria-label={t("agentManager.tab.terminal")}
      aria-hidden={!props.visible()}
    >
      <InspectorTabStrip
        ids={ids}
        active={active}
        label={t("agentManager.tab.terminal")}
        overlay={(id) => props.state.title(id) ?? t("agentManager.tab.terminal")}
        onSelect={props.onSelect}
        onReorder={(from, to) => props.state.reorderSideDrag(props.contextKey(), from, to)}
        renderTab={(id, api) => {
          const term = sides().find((item) => item.id === id)
          if (!term) return null
          return (
            <SortableTerminalTab
              id={term.id}
              label={props.state.title(term.id) ?? term.title}
              tooltip={props.state.title(term.id) ?? term.title}
              status={props.state.scriptStatus(term.id)}
              showKeybind={false}
              keybind={active() === term.id ? "" : props.nextKeybind}
              closeKeybind={props.closeKeybind}
              active={active() === term.id}
              focused={props.state.sideFocusedId() === term.id}
              role="tab"
              selected={active() === term.id}
              tabIndex={active() === term.id ? 0 : -1}
              onKeyDown={(event) => api.focus.key(term.id, event)}
              onSelect={() => props.onSelect(term.id)}
              onMiddleClick={(event) => {
                if (event.button !== 1) return
                event.preventDefault()
                event.stopPropagation()
                close(term.id, api.focus)
              }}
              onClose={() => close(term.id, api.focus)}
              onCloseOthers={() => props.onCloseOthers(term.id)}
              onStop={(event) => {
                event.stopPropagation()
                props.onStop(term.id)
              }}
            />
          )
        }}
        action={(api) => (
          <div class="am-side-terminal-add">
            <Tooltip value={t("agentManager.terminal.add")} placement="bottom">
              <IconButton
                icon="plus"
                size="small"
                variant="ghost"
                aria-label={t("agentManager.terminal.add")}
                onClick={() => {
                  api.release()
                  props.onStart()
                }}
              />
            </Tooltip>
          </div>
        )}
      />
      {renderSideTerminalLayer({
        state: props.state,
        contextKey: props.contextKey,
        visible: props.visible,
        onFocusPrompt: props.onFocusPrompt,
        onFocusChange: props.onFocusChange,
      })}
      <Show when={props.visible() && sides().length === 0 && pending()}>
        <div class="am-side-terminal-state" role="status">
          <Spinner />
          <span>{t("common.loading")}</span>
        </div>
      </Show>
      <Show when={props.visible() && sides().length === 0 && !pending()}>
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
