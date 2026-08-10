import type { PanelContext } from "./host"

export function focusPanelPrompt(panel: PanelContext, ready: Promise<boolean>, active: Promise<boolean>): void {
  void Promise.all([ready, active]).then(([ready, active]) => {
    if (!ready || !active) return
    panel.postMessage({ type: "action", action: "focusInput" })
  })
}

export function revealPanel(panel: PanelContext, preserve: boolean | undefined, focus?: () => void): void {
  panel.reveal(preserve)
  if (!preserve) focus?.()
}
