import type { UiI18nParams } from "@kilocode/kilo-ui/context"

type T = (key: string, params?: UiI18nParams) => string

const notices: Record<string, string> = {
  "snapshots-disabled": "diffViewer.notice.snapshotsDisabled",
}

export function notice(t: T, kind?: string) {
  return kind ? t(notices[kind] ?? kind) : ""
}

export function reviewSendAllKeybind(t: T): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? t("agentManager.review.sendAllShortcut.mac")
    : t("agentManager.review.sendAllShortcut.other")
}

export function reviewFocus(root: () => HTMLElement | undefined): void {
  root()?.focus({ preventScroll: true })
}

export function keepsNativeFocus(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return true
  return target instanceof HTMLElement && target.isContentEditable
}
