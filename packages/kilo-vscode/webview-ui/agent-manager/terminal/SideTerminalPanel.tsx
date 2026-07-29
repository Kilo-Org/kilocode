/**
 * Right-side terminal panel for the Agent Manager inspector.
 *
 * Lives inside the shared `.am-diff-panel-wrapper` host next to the diff
 * and PR panels, so all three inspector modes share one resize handle
 * and one width.
 *
 * A context can own several side terminals. The header is a tab strip
 * that reuses the top tab bar's `TerminalTabChrome` (same `am-tab*`
 * structure, same X close button) plus a `+` action to add terminals.
 * Tabs are drag-sortable via the same `@thisbeyond/solid-dnd` stack as
 * the top tab bar; the order lives in the terminal state, so it is
 * preserved across sidebar context switches for the webview's lifetime.
 * The strip stays visible even when empty so the `+` action is always
 * reachable.
 *
 * Visibility is opacity-based, never unmount: the xterm render loop
 * dies when its subtree leaves the paint tree (see `render.tsx`).
 */

import type { Accessor, Component } from "solid-js"
import { For, Show, createEffect, createSignal } from "solid-js"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Button } from "@kilocode/kilo-ui/button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../src/context/language"
import { ConstrainDragYAxis, SortableTabContainer } from "../../src/components/chat/TabDnd"
import { renderSideTerminalLayer } from "./render"
import { TerminalTabChrome } from "./SortableTerminalTab"
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
  /** Create a new side terminal for this context. */
  onStart: () => void
}

export const SideTerminalPanel: Component<Props> = (props) => {
  const { t } = useLanguage()
  let panel!: HTMLElement
  createEffect(() => {
    panel.inert = !props.visible()
  })
  const [dragging, setDragging] = createSignal<{ id: string; width: number } | undefined>()
  const sides = () => props.state.sidesForContext(props.contextKey())
  const ids = () => sides().map((term) => term.id)
  const pending = () => props.state.pendingSide(props.contextKey())
  const onDragStart = (event: DragEvent) => {
    const id = event.draggable?.id
    if (typeof id !== "string") return
    // Pin the overlay to the tab's width: the overlay container uses
    // min-width, so a long OSC title would otherwise overflow it and
    // shift the visual center off the cursor (the "drag offset" bug).
    const width = event.draggable?.layout.width ?? event.draggable?.node.getBoundingClientRect().width
    setDragging({ id, width })
  }
  const onDragEnd = () => setDragging(undefined)
  const onDragOver = (event: DragEvent) => {
    const from = event.draggable?.id
    const to = event.droppable?.id
    if (typeof from !== "string" || typeof to !== "string") return
    props.state.reorderSideDrag(props.contextKey(), from, to)
  }
  return (
    <section
      ref={panel}
      class={`am-side-terminal ${props.visible() ? "am-side-terminal-visible" : ""}`}
      aria-label={t("agentManager.tab.terminal")}
      aria-hidden={!props.visible()}
    >
      <div class="am-side-terminal-tabs">
        <DragDropProvider
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          collisionDetector={closestCenter}
        >
          <DragDropSensors />
          <ConstrainDragYAxis />
          {/* Scrollable tab list — mirrors the top bar's .am-tab-list split
              so the "+" action never scrolls away. role="tablist" only
              when tabs exist: axe aria-required-children rejects an empty
              tablist (and non-tab children like the add button). */}
          <div
            class="am-side-terminal-tablist"
            role={sides().length > 0 ? "tablist" : undefined}
            aria-label={sides().length > 0 ? t("agentManager.tab.terminal") : undefined}
          >
            <SortableProvider ids={ids()}>
              <For each={sides()}>
                {(term) => (
                  <SortableTabContainer id={term.id} class="am-side-terminal-tab">
                    <TerminalTabChrome
                      label={props.state.title(term.id) ?? term.title}
                      tooltip={props.state.title(term.id) ?? term.title}
                      active={props.state.sideActiveFor(props.contextKey()) === term.id}
                      role="tab"
                      selected={props.state.sideActiveFor(props.contextKey()) === term.id}
                      onSelect={() => props.onSelect(term.id)}
                      onMiddleClick={(e: MouseEvent) => {
                        if (e.button !== 1) return
                        e.preventDefault()
                        e.stopPropagation()
                        props.onClose(term.id)
                      }}
                      onClose={(e: MouseEvent) => {
                        e.stopPropagation()
                        props.onClose(term.id)
                      }}
                    />
                  </SortableTabContainer>
                )}
              </For>
            </SortableProvider>
          </div>
          {/* Cursor-following clone of the dragged tab (same pattern as
              the top tab bar). The overlay is what makes the in-list
              original use solid-dnd's slot-compensated transform, so the
              dragged tab tracks the cursor without a jump/offset. The
              original stays dimmed in its slot via .am-tab-dragging. */}
          <DragOverlay>
            <Show when={dragging()}>
              {(tab) => (
                <div class="am-tab am-tab-overlay" style={{ width: `${tab().width}px` }}>
                  <span class="am-tab-label">{props.state.title(tab().id) ?? t("agentManager.tab.terminal")}</span>
                </div>
              )}
            </Show>
          </DragOverlay>
        </DragDropProvider>
        <div class="am-side-terminal-add">
          <Tooltip value={t("agentManager.terminal.add")} placement="bottom">
            <IconButton
              icon="plus"
              size="small"
              variant="ghost"
              aria-label={t("agentManager.terminal.add")}
              onClick={props.onStart}
            />
          </Tooltip>
        </div>
      </div>
      {renderSideTerminalLayer({ state: props.state, contextKey: props.contextKey, visible: props.visible })}
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
