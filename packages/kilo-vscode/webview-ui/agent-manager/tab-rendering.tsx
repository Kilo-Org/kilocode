/**
 * JSX helpers for the agent-manager tab bar and terminal layer.
 *
 * Extracted from AgentManagerApp.tsx to keep that file under the
 * `max-lines` lint cap. These are not standalone components — they are
 * render helpers the main component composes with its `<For>` tab loop
 * and content area.
 */

import { Show } from "solid-js"
import type { JSX } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { Icon } from "@kilocode/kilo-ui/icon"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { SortableTab, SortableReviewTab } from "./sortable-tab"
import type { TerminalStateControls } from "./terminal"
import { isTerminalTabId, renderTerminalTab } from "./terminal"
import type { SessionInfo } from "../src/types/messages"
import { parseBindingTokens } from "./keybind-tokens"

export interface TabRenderDeps {
  terms: TerminalStateControls
  REVIEW_TAB_ID: string
  tabIds: () => string[]
  kb: () => Record<string, string>
  reviewActive: () => boolean
  currentSessionID: () => string | undefined
  activePendingId: () => string | undefined
  /** Id of the currently visible tab. Single source of truth — kept in
   *  the parent component as `visibleTabId` (sessions, review, and
   *  terminal kinds collapsed into one id string). Consumed here as a
   *  getter so Solid tracks its reactivity inside rendered JSX. */
  visibleTabId: () => string | undefined
  isPending: (id: string) => boolean
  tabLookup: () => Map<string, SessionInfo>
  adjacentHint: (id: string, activeId: string, ids: string[], prev: string, next: string) => string
  // Handlers
  activateTerminal: (id: string) => void
  deactivateTerminal: () => void
  closeTerminal: (id: string) => void
  terminalMiddleClick: (id: string, e: MouseEvent) => void
  closeReview: () => void
  reviewMiddleClick: (e: MouseEvent) => void
  selectReviewTab: () => void
  selectSessionTab: (id: string, pending: boolean) => void
  sessionMiddleClick: (id: string, e: MouseEvent) => void
  sessionClose: (id: string) => void
  sessionFork: (id: string) => void
  reviewLabel: string
  reviewTooltip: string
}

/** Render a single tab by id — routes to terminal / review / session render paths. */
export function renderTab(id: string, deps: TabRenderDeps): JSX.Element {
  if (isTerminalTabId(id)) {
    // Pass `keybind` as a getter — Solid's JSX compiler wraps getter
    // calls in reactive effects, so the tooltip stays in sync with
    // `activeId` / `tabIds()` changes. A precomputed string would
    // capture the value at render time and never update.
    return renderTerminalTab({
      id,
      terms: deps.terms,
      keybind: () =>
        deps.adjacentHint(
          id,
          deps.visibleTabId() ?? "",
          deps.tabIds(),
          deps.kb().previousTab ?? "",
          deps.kb().nextTab ?? "",
        ),
      closeKeybind: () => deps.kb().closeTab ?? "",
      onSelect: deps.activateTerminal,
      onMiddleClick: deps.terminalMiddleClick,
      onClose: deps.closeTerminal,
    })
  }
  if (id === deps.REVIEW_TAB_ID) return renderReviewTab(deps)
  const s = deps.tabLookup().get(id)
  if (!s) return null
  return renderSessionTab(s, deps)
}

function renderReviewTab(deps: TabRenderDeps): JSX.Element {
  const keybind = deps.reviewActive()
    ? ""
    : deps.adjacentHint(
        deps.REVIEW_TAB_ID,
        deps.visibleTabId() ?? "",
        deps.tabIds(),
        deps.kb().previousTab ?? "",
        deps.kb().nextTab ?? "",
      )
  return (
    <SortableReviewTab
      id={deps.REVIEW_TAB_ID}
      label={deps.reviewLabel}
      tooltip={deps.reviewTooltip}
      keybind={keybind}
      closeKeybind={deps.kb().closeTab ?? ""}
      active={deps.reviewActive() && !deps.terms.activeId()}
      onSelect={() => {
        deps.deactivateTerminal()
        deps.selectReviewTab()
      }}
      onMiddleClick={deps.reviewMiddleClick}
      onClose={(e: MouseEvent) => {
        e.stopPropagation()
        deps.closeReview()
      }}
    />
  )
}

function renderSessionTab(s: SessionInfo, deps: TabRenderDeps): JSX.Element {
  const pending = deps.isPending(s.id)
  const active = () =>
    !deps.terms.activeId() &&
    (pending ? s.id === deps.activePendingId() && !deps.currentSessionID() : s.id === deps.currentSessionID())
  const keybind = () => {
    if (active()) return ""
    return deps.adjacentHint(
      s.id,
      deps.visibleTabId() ?? "",
      deps.tabIds(),
      deps.kb().previousTab ?? "",
      deps.kb().nextTab ?? "",
    )
  }
  return (
    <SortableTab
      tab={s}
      active={active() && !deps.reviewActive()}
      keybind={keybind()}
      closeKeybind={deps.kb().closeTab ?? ""}
      onSelect={() => {
        deps.deactivateTerminal()
        deps.selectSessionTab(s.id, pending)
      }}
      onMiddleClick={(e: MouseEvent) => deps.sessionMiddleClick(s.id, e)}
      onClose={() => deps.sessionClose(s.id)}
      onFork={pending ? undefined : () => deps.sessionFork(s.id)}
    />
  )
}

// Terminal-specific renderers (layer + add button) live in `./terminal/render.tsx`
// and are re-exported for convenience so AgentManagerApp.tsx has a single
// import point for tab rendering.
export { renderTerminalLayer } from "./terminal"

export interface NewTabButtonDeps {
  contextSelected: () => boolean
  kb: () => Record<string, string>
  newSessionLabel: string
  newTerminalLabel: string
  newSessionMenuLabel: string
  moreOptionsLabel: string
  onNewSession: () => void
  onNewTerminal: () => void
}

/**
 * Render the tab bar's "new" affordance: a split button with the plus
 * icon (primary action: new agent session) and a chevron that opens a
 * dropdown menu for picking between "New Session" and "New Terminal".
 * Mirrors the worktree split-button at the top of the sidebar. Falls
 * back to nothing when no sidebar context is selected (tab bar isn't
 * visible anyway).
 */
export function renderNewTabButton(deps: NewTabButtonDeps): JSX.Element {
  return (
    <Show when={deps.contextSelected()}>
      <div class="am-split-button am-tab-add-split">
        <TooltipKeybind title={deps.newSessionLabel} keybind={deps.kb().newTab ?? ""} placement="bottom">
          <IconButton
            icon="plus"
            size="small"
            variant="ghost"
            label={deps.newSessionLabel}
            onClick={deps.onNewSession}
          />
        </TooltipKeybind>
        <DropdownMenu gutter={4} placement="bottom-end">
          <DropdownMenu.Trigger class="am-split-arrow" aria-label={deps.moreOptionsLabel}>
            <Icon name="chevron-down" size="small" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="am-split-menu">
              <DropdownMenu.Item onSelect={deps.onNewSession}>
                <Icon name="plus" size="small" />
                <DropdownMenu.ItemLabel>{deps.newSessionMenuLabel}</DropdownMenu.ItemLabel>
                <span class="am-menu-shortcut">
                  {parseBindingTokens(deps.kb().newTab ?? "").map((token) => (
                    <kbd class="am-menu-key">{token}</kbd>
                  ))}
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={deps.onNewTerminal}>
                <Icon name="console" size="small" />
                <DropdownMenu.ItemLabel>{deps.newTerminalLabel}</DropdownMenu.ItemLabel>
                <span class="am-menu-shortcut">
                  {parseBindingTokens(deps.kb().newTerminal ?? "").map((token) => (
                    <kbd class="am-menu-key">{token}</kbd>
                  ))}
                </span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
    </Show>
  )
}
