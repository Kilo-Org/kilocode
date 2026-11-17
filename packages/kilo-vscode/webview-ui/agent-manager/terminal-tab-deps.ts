import { closeOthers } from "./close-others"
import { closableRightOf, closeToRight } from "./close-to-right"
import type { CloseToRightDeps } from "../src/utils/tab-close"
import type { TerminalStateControls } from "./terminal/state"

/** The part of the tab render deps a terminal tab reads. Kept free of JSX modules so tests can load it. */
export interface TerminalTabSource extends CloseToRightDeps {
  terms: TerminalStateControls
  tabIds: () => string[]
  kb: () => Record<string, string>
  adjacentHint: (id: string, active: string, ids: string[], prev: string, next: string) => string
  terminalMiddleClick: (id: string, event: MouseEvent) => void
  onTabKey: (id: string, event: KeyboardEvent) => void
}

/** The terminal tab entry, with getters for everything that changes while the tab stays mounted. */
export function terminalTabDeps(id: string, deps: TerminalTabSource) {
  // Pass `keybind` as a getter — Solid's JSX compiler wraps getter
  // calls in reactive effects, so the tooltip stays in sync with
  // `activeId` / `tabIds()` changes. A precomputed string would
  // capture the value at render time and never update.
  return {
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
    onCloseOthers: (target: string) => closeOthers(target, deps),
    // Getter so the menu item reacts to tabs opening, closing, or reordering.
    get onCloseToRight() {
      return closableRightOf(id, deps.tabIds(), deps.REVIEW_TAB_ID, deps.isPinned).length
        ? (target: string) => closeToRight(target, deps)
        : undefined
    },
    role: "tab" as const,
    // Getters for the same reason: a captured value left a hidden terminal tab selected and in the tab order.
    get selected() {
      return deps.visibleTabId() === id
    },
    get tabIndex() {
      return deps.visibleTabId() === id ? 0 : -1
    },
    onKeyDown: (event: KeyboardEvent) => deps.onTabKey(id, event),
  }
}
