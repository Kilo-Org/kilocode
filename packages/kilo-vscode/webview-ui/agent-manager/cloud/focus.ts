import { agentManagerFocusTarget, focusChatTarget, type AgentManagerFocusTarget } from "../focus"
import { hasPopup, hasTextSelection } from "../../src/utils/focus"

const overlay = '[role="menu"], [role="dialog"], [role="alertdialog"]'
const detail = () => document.querySelector<HTMLElement>(".am-cloud-detail")

export function cloudDraftMayFocus() {
  return (
    !document.activeElement?.closest(`.am-cloud-terminal, [role="tab"], ${overlay}`) && !document.querySelector(overlay)
  )
}

/** Explicit tab activation and the xterm shortcut enter the visible question or composer, once. */
export function focusCloudChat(fromTerminal = false) {
  const root = detail()
  if (!root || !document.hasFocus() || document.querySelector(overlay) || root.querySelector(".chat-input[inert]"))
    return
  const active = document.activeElement
  if (fromTerminal && active instanceof HTMLElement && active.closest(".am-cloud-terminal")) active.blur()
  focusChatTarget(true, false, root)
}

/** Chromium normally retains the focused element. Recover only when the webview returns with focus on its body. */
export function bindCloudFocus(root: HTMLElement, report: (target: AgentManagerFocusTarget) => void) {
  let last: HTMLElement | undefined
  const remember = (event: FocusEvent) => {
    last = event.target instanceof HTMLElement && event.target !== document.body ? event.target : undefined
    report(agentManagerFocusTarget(last ?? null))
  }
  const restore = () => {
    if (document.activeElement !== document.body || !root.isConnected || hasPopup() || hasTextSelection()) return
    if (last?.isConnected && !last.closest('[inert], [aria-hidden="true"]')) {
      last.focus({ preventScroll: true })
      return
    }
    if (!document.querySelector(overlay) && !root.querySelector(".chat-input[inert]"))
      focusChatTarget(false, false, root)
  }
  document.addEventListener("focusin", remember)
  window.addEventListener("focus", restore)
  return () => {
    document.removeEventListener("focusin", remember)
    window.removeEventListener("focus", restore)
    report("other")
  }
}
