/**
 * xterm.js terminal tabs for the Agent Manager.
 *
 * All user-visible feature code lives in this folder so it can be
 * removed as one unit if the feature is ever retired.
 *
 * Public surface:
 * - `createTerminalState` — per-context tabs signal + active-id focus
 * - `createTerminalHandlers` — close/middle-click/activate/new/closeActive
 * - `createTerminalMessageHandler` — routes inbound messages to state
 * - `renderTerminalTab` / `renderTerminalLayer`
 * - `isTerminalTabId`, `TERMINAL_PREFIX`, type exports
 */

export {
  TERMINAL_PREFIX,
  isTerminalTabId,
  createTerminalState,
  createTerminalHandlers,
  createTerminalMessageHandler,
} from "./state"
export type { TerminalTabState, TerminalStateControls, TerminalHandlerDeps } from "./state"
export { renderTerminalTab, renderTerminalLayer } from "./render"
export { TerminalTab } from "./TerminalTab"
export { SortableTerminalTab } from "./SortableTerminalTab"
