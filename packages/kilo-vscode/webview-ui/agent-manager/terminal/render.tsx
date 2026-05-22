/**
 * JSX render helpers for xterm terminal tabs.
 *
 * Kept separate from the general tab-rendering module so the terminal
 * feature is self-contained under `terminal/` and the whole folder can
 * be removed as one unit if the feature is ever retired.
 */

import { For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { SortableTerminalTab } from "./SortableTerminalTab"
import { TerminalTab } from "./TerminalTab"
import type { TerminalStateControls } from "./state"

export interface TerminalTabRenderDeps {
  id: string
  terms: TerminalStateControls
  /** Reactive accessor — called inside JSX so Solid wraps it in an effect. */
  closeKeybind: () => string
  /** Reactive accessor — e.g. the `⌘⌥→` hint when this tab is adjacent to active. */
  keybind: () => string
  onSelect: (id: string) => void
  onMiddleClick: (id: string, e: MouseEvent) => void
  onClose: (id: string) => void
}

/** Render the terminal entry inside the agent-manager tab bar `<For>`. */
export function renderTerminalTab(deps: TerminalTabRenderDeps): JSX.Element {
  const term = deps.terms.lookup().get(deps.id)
  if (!term) return null
  const isActive = () => deps.terms.activeId() === deps.id
  return (
    <SortableTerminalTab
      id={deps.id}
      label={term.title}
      tooltip={term.title}
      keybind={isActive() ? "" : deps.keybind()}
      closeKeybind={deps.closeKeybind()}
      active={isActive()}
      onSelect={() => deps.onSelect(deps.id)}
      onMiddleClick={(e: MouseEvent) => deps.onMiddleClick(deps.id, e)}
      onClose={(e: MouseEvent) => {
        e.stopPropagation()
        deps.onClose(deps.id)
      }}
    />
  )
}

/**
 * Render the persistent xterm layer that stacks every terminal tab.
 *
 * ## Invariant
 *
 * **Once an xterm instance is mounted, its DOM subtree must never leave
 * the browser's paint tree.** `display: none` on any ancestor detaches
 * the subtree: xterm's internal `requestAnimationFrame` render loop
 * stops, the canvas goes stale, and no amount of `term.refresh()` can
 * reliably restart the loop fast enough on reattachment — that's the
 * "press Enter to see content" bug users hit when switching worktrees.
 *
 * ## Design
 *
 * Both the outer layer and each individual terminal slot are
 * `position: absolute; inset: 0` — stacked on top of the chat area and
 * on top of each other. Visibility is controlled purely via CSS classes
 * that toggle `opacity`, `pointer-events`, and `z-index`. Elements with
 * `opacity: 0` stay in the paint tree (unlike `display: none`), so
 * xterm's render loop keeps firing and every canvas stays composed and
 * ready for instant reveal.
 *
 * The layer is mounted under `<Show>` only when at least one terminal
 * exists; that boundary never flips under a live xterm, since removing
 * the last terminal disposes its instance first.
 */
export function renderTerminalLayer(props: { state: TerminalStateControls }): JSX.Element {
  const layerActive = () => props.state.activeId() !== undefined
  const slotVisible = (termId: string, contextKey: string) =>
    props.state.activeId() === termId && props.state.currentKey() === contextKey
  return (
    <Show when={props.state.all().length > 0}>
      <div class={`am-terminal-layer ${layerActive() ? "am-terminal-layer-active" : ""}`}>
        <For each={props.state.all()}>
          {(term) => {
            const visible = () => slotVisible(term.id, term.contextKey)
            return (
              <div class={`am-terminal-slot ${visible() ? "am-terminal-slot-visible" : ""}`}>
                <TerminalTab terminalId={term.id} wsUrl={term.wsUrl} active={visible()} />
              </div>
            )
          }}
        </For>
      </div>
    </Show>
  )
}
