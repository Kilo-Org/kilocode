/**
 * JSX render helpers for xterm terminal tabs.
 *
 * Kept separate from the general tab-rendering module so the terminal
 * feature is self-contained under `terminal/` and the whole folder can
 * be removed as one unit if the feature is ever retired.
 */

import { For, Show } from "solid-js"
import type { Accessor, JSX } from "solid-js"
import { SortableTerminalTab } from "./SortableTerminalTab"
import { TerminalTab } from "./TerminalTab"
import type { TerminalStateControls } from "./state"

/** Serial of the latest focus request addressed to `id`, or 0. Read
 *  inside JSX so the effect re-runs when a request lands. */
function focusSerial(state: TerminalStateControls, id: string): number {
  const request = state.focusRequest()
  return request?.id === id ? request.serial : 0
}

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
  onCloseOthers: (id: string) => void
  role?: "tab"
  selected?: boolean
  tabIndex?: number
  onKeyDown?: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent>
}

/** Render the terminal entry inside the agent-manager tab bar `<For>`. */
export function renderTerminalTab(deps: TerminalTabRenderDeps): JSX.Element {
  const term = deps.terms.lookup().get(deps.id)
  if (!term) return null
  const isActive = () => deps.terms.activeId() === deps.id
  // Label and tooltip read through `terms.title` so OSC title changes
  // (shell/program escape codes) rename the tab live.
  return (
    <SortableTerminalTab
      id={deps.id}
      label={deps.terms.title(deps.id) ?? term.title}
      tooltip={deps.terms.title(deps.id) ?? term.title}
      status={deps.terms.scriptStatus(deps.id)}
      keybind={isActive() ? "" : deps.keybind()}
      closeKeybind={deps.closeKeybind()}
      focused={deps.terms.focusedId() === deps.id}
      active={isActive()}
      role={deps.role}
      selected={deps.selected}
      tabIndex={deps.tabIndex}
      onKeyDown={deps.onKeyDown}
      onSelect={() => deps.onSelect(deps.id)}
      onMiddleClick={(e: MouseEvent) => deps.onMiddleClick(deps.id, e)}
      onClose={() => deps.onClose(deps.id)}
      onCloseOthers={() => deps.onCloseOthers(deps.id)}
    />
  )
}

/**
 * Render the persistent xterm layer that stacks every terminal tab.
 *
 * ## Invariant
 *
 * **Once an xterm instance is mounted, its DOM subtree is only ever
 * hidden, never unmounted.** Inactive slots keep their layout box but
 * are translated one viewport off-screen; xterm 6's render service
 * observes the screen element and pauses the render loop (rAF and model
 * updates) for non-intersecting terminals, then replays a
 * full refresh when the slot slides back in. Keeping the box (unlike
 * `display: none`) also lets FitAddon measure the real panel size while
 * hidden, so background-created terminals such as setup scripts wrap
 * output at the panel's width from the start. Hiding via opacity instead
 * — the historical workaround for the "press Enter to see content" bug,
 * where reattachment left a stale canvas — kept the render loop running
 * at full rate for output no one sees. `TerminalTab`'s activation
 * repaint (fit + refresh) remains as insurance on top of xterm's own
 * resume.
 *
 * ## Design
 *
 * Both the outer layer and each individual terminal slot are
 * `position: absolute; inset: 0` — stacked on top of the chat area and
 * on top of each other. The layer controls whether a terminal is visible
 * at all; slots control which terminal of a context is shown.
 *
 * The layer is mounted under `<Show>` only when at least one terminal
 * exists; that boundary never flips under a live xterm, since removing
 * the last terminal disposes its instance first.
 */
export function renderTerminalLayer(props: {
  state: TerminalStateControls
  onFocusPrompt: () => void
  onFocusChange?: (focused: boolean) => void
}): JSX.Element {
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
              <div class={`am-terminal-slot ${visible() ? "am-terminal-slot-visible" : ""}`} inert={!visible()}>
                <TerminalTab
                  terminalId={term.id}
                  wsUrl={term.wsUrl}
                  restartable={term.kind === undefined}
                  active={visible()}
                  focusSerial={focusSerial(props.state, term.id)}
                  font={term.font}
                  onFocusChange={(focused) => {
                    if (focused) props.state.setFocusedId(term.id)
                    else if (props.state.focusedId() === term.id) props.state.setFocusedId(undefined)
                    props.onFocusChange?.(focused)
                  }}
                  onFocusPrompt={props.onFocusPrompt}
                  onTitleChange={(title) => props.state.setTitle(term.id, title)}
                />
              </div>
            )
          }}
        </For>
      </div>
    </Show>
  )
}

/**
 * Render the side-panel terminal layer inside the right-hand inspector.
 *
 * Same invariant as `renderTerminalLayer`: every side terminal stays
 * mounted, inactive slots are translated off-screen so xterm's render
 * observer pauses them while FitAddon keeps measuring, and only the
 * visible tab's slot is shown. The layer is scoped to `contextKey` —
 * side terminals from other
 * contexts stay paused in the background and never refit — and within a
 * context only the active strip tab's terminal is shown.
 */
export function renderSideTerminalLayer(props: {
  state: TerminalStateControls
  contextKey: Accessor<string>
  visible: Accessor<boolean>
  onFocusPrompt: () => void
  onFocusChange?: (focused: boolean) => void
}): JSX.Element {
  return (
    <div class={`am-side-terminal-layer ${props.visible() ? "am-side-terminal-layer-active" : ""}`}>
      <For each={props.state.sides()}>
        {(term) => {
          const active = () =>
            props.visible() &&
            term.contextKey === props.contextKey() &&
            props.state.sideActiveFor(term.contextKey) === term.id
          return (
            <div class={`am-terminal-slot ${active() ? "am-terminal-slot-visible" : ""}`} inert={!active()}>
              <TerminalTab
                terminalId={term.id}
                wsUrl={term.wsUrl}
                active={active()}
                focusOnActivate={false}
                focusSerial={focusSerial(props.state, term.id)}
                font={term.font}
                status={() => props.state.scriptStatus(term.id)}
                restartable={term.kind === undefined}
                onFocusChange={(focused) => {
                  if (focused) props.state.setFocusedId(term.id)
                  else if (props.state.focusedId() === term.id) props.state.setFocusedId(undefined)
                  props.onFocusChange?.(focused)
                }}
                onFocusPrompt={props.onFocusPrompt}
                onTitleChange={(title) => props.state.setTitle(term.id, title)}
              />
            </div>
          )
        }}
      </For>
    </div>
  )
}
