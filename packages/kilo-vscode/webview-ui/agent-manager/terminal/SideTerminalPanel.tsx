/**
 * Right-side terminal panel for the Agent Manager inspector.
 *
 * Lives inside the shared `.am-diff-panel-wrapper` host next to the diff
 * and PR panels, so all three inspector modes share one resize handle
 * and one width.
 *
 * A context can own several side terminals. The header is a tab strip
 * that reuses the top tab bar's whole chrome: `SortableTerminalTab`
 * (icon, title, X close, right-click Close / Close Others), the same
 * `@thisbeyond/solid-dnd` reorder stack, the same overflow scrolling
 * with edge fades, the same width freeze while tabs close, and the same
 * arrow-key tab navigation, so a terminal behaves identically in
 * either surface. Reorder state lives in the terminal state, so it is
 * preserved across sidebar context switches for the webview's lifetime.
 *
 * The `+` action sits directly after the last tab (outside the
 * scrolling region, like the tab bar's `am-tab-add-wrap`), so it never
 * scrolls away and never drifts to the far edge of a wide panel. The
 * strip stays visible even when empty so `+` is always reachable.
 *
 * Visibility is opacity-based, never unmount: the xterm render loop
 * dies when its subtree leaves the paint tree (see `render.tsx`).
 */

import type { Accessor, Component, JSX } from "solid-js"
import { For, Show, createEffect, createSignal } from "solid-js"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Button } from "@kilocode/kilo-ui/button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip, TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../src/context/language"
import { ConstrainDragYAxis } from "../../src/components/chat/TabDnd"
import { useTabScroll } from "../../src/utils/tab-scroll"
import { setTabWidths } from "../../src/utils/tab-widths"
import { createTabFocus } from "../../src/utils/tab-navigation"
import { renderSideTerminalLayer } from "./render"
import { SortableTerminalTab } from "./SortableTerminalTab"
import type { TerminalStateControls } from "./state"

/** Only this strip's tabs freeze; the top tab bar keeps its own widths. */
const TABLIST = ".am-side-terminal-tablist"

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
}

export const SideTerminalPanel: Component<Props> = (props) => {
  const { t } = useLanguage()
  let panel!: HTMLElement
  let strip!: HTMLDivElement
  createEffect(() => {
    panel.inert = !props.visible()
  })
  const [dragging, setDragging] = createSignal<{ id: string; width: number } | undefined>()
  const sides = () => props.state.sidesForContext(props.contextKey())
  const ids = () => sides().map((term) => term.id)
  const active = () => props.state.sideActiveFor(props.contextKey())
  const pending = () => props.state.pendingSide(props.contextKey())
  const scroll = useTabScroll(ids, active)
  // Scoped to `strip` so arrow keys and focus restore never jump to a
  // tab in the top bar, which uses the same role="tab" markup.
  const focus = createTabFocus({ ids, select: props.onSelect, root: () => strip })
  // Only freeze while the pointer is over the strip: the widths must
  // survive until the pointer leaves, so the remaining X buttons stay
  // put across repeated closes. Releasing on the next frame would undo
  // the freeze before it is ever painted (rAF runs before paint).
  // "Close others" needs none of this: its context menu is portaled, so
  // the pointer is off the strip, and the survivor spans the strip anyway.
  const freeze = () => {
    if (strip.closest(".am-side-terminal-tabs")?.matches(":hover")) setTabWidths(true, document, TABLIST)
  }
  const release = () => setTabWidths(false, document, TABLIST)
  const close = (id: string) => {
    freeze()
    props.onClose(id)
    // Restore focus inside the strip only while it still owns a tab.
    // Falling through to `focusPrompt` would pull focus into the chat
    // composer while the panel is still open on its empty state.
    if (ids().length > 0) focus.restore()
  }
  // Adding a tab shrinks every tab's equal share, so any freeze left
  // over from a close in the same hover has to go first. `+` lives
  // inside the strip, so no pointerleave happens between the two
  // clicks and the surviving tabs would keep their wider pixel widths.
  const start = () => {
    release()
    props.onStart()
  }
  const onDragStart = (event: DragEvent) => {
    const id = event.draggable?.id
    if (typeof id !== "string") return
    // Pin the overlay to the tab's width: the overlay container uses
    // min-width, so a long OSC title would otherwise overflow it and
    // shift the visual center off the cursor (the "drag offset" bug).
    const width = event.draggable?.layout.width ?? event.draggable?.node.getBoundingClientRect().width
    setTabWidths(true, document, TABLIST)
    setDragging({ id, width })
  }
  const onDragEnd = () => {
    setDragging(undefined)
    release()
  }
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
      <div
        class="am-side-terminal-tabs"
        onPointerLeave={() => {
          if (!dragging()) release()
        }}
      >
        <DragDropProvider
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          collisionDetector={closestCenter}
        >
          <DragDropSensors />
          <ConstrainDragYAxis />
          {/* Overflow chrome copied from the top tab bar: the list is the
              only scrolling element, wrapped by a fade host, so the "+"
              action stays pinned next to the last tab. */}
          <div class="am-tab-scroll-area">
            <div class={`am-tab-fade am-tab-fade-left ${scroll.showLeft() ? "am-tab-fade-visible" : ""}`} />
            <div class="am-tab-list-wrap">
              {/* role="tablist" only when tabs exist: axe
                  aria-required-children rejects an empty tablist. */}
              <div
                class="am-side-terminal-tablist"
                ref={(el) => {
                  strip = el
                  scroll.setRef(el)
                }}
                role={sides().length > 0 ? "tablist" : undefined}
                aria-label={sides().length > 0 ? t("agentManager.tab.terminal") : undefined}
                style={{ "--tab-count": `${sides().length}` } as JSX.CSSProperties}
              >
                <SortableProvider ids={ids()}>
                  <For each={sides()}>
                    {(term) => (
                      <SortableTerminalTab
                        id={term.id}
                        label={props.state.title(term.id) ?? term.title}
                        tooltip={props.state.title(term.id) ?? term.title}
                        status={props.state.scriptStatus(term.id)}
                        keybind={active() === term.id ? "" : props.nextKeybind}
                        closeKeybind={props.closeKeybind}
                        active={active() === term.id}
                        focused={props.state.sideFocusedId() === term.id}
                        role="tab"
                        selected={active() === term.id}
                        tabIndex={active() === term.id ? 0 : -1}
                        onKeyDown={(event) => focus.key(term.id, event)}
                        onSelect={() => props.onSelect(term.id)}
                        onMiddleClick={(e: MouseEvent) => {
                          if (e.button !== 1) return
                          e.preventDefault()
                          e.stopPropagation()
                          close(term.id)
                        }}
                        onClose={(e: MouseEvent) => {
                          e.stopPropagation()
                          close(term.id)
                        }}
                        onCloseOthers={() => props.onCloseOthers(term.id)}
                        onStop={(e: MouseEvent) => {
                          e.stopPropagation()
                          props.onStop(term.id)
                        }}
                      />
                    )}
                  </For>
                </SortableProvider>
              </div>
            </div>
            <div class={`am-tab-fade am-tab-fade-right ${scroll.showRight() ? "am-tab-fade-visible" : ""}`} />
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
              onClick={start}
            />
          </Tooltip>
        </div>
      </div>
      {renderSideTerminalLayer({
        state: props.state,
        contextKey: props.contextKey,
        visible: props.visible,
        onFocusPrompt: props.onFocusPrompt,
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
