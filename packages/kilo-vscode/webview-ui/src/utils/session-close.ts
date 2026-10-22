export interface SessionTabBar {
  ids: () => readonly string[]
  visible: () => string | undefined
  isPending: (id: string) => boolean
  isPinned: (id: string) => boolean
  close: (id: string) => void
  reveal: (id: string) => void
}

/** Close-to-right deps for a session-only tab bar. */
export function sessionCloseDeps(bar: SessionTabBar) {
  return {
    tabIds: bar.ids,
    visibleTabId: bar.visible,
    isPending: bar.isPending,
    isPinned: bar.isPinned,
    selectSessionTab: bar.reveal,
    sessionClose: bar.close,
  }
}

/** Session tabs after `target` in rendered order that Close to the Right would close. */
export function closableRight(target: string, deps: ReturnType<typeof sessionCloseDeps>): string[] {
  const ids = deps.tabIds()
  const index = ids.indexOf(target)
  if (index < 0) return []
  return ids.slice(index + 1).filter((id) => !deps.isPinned(id))
}

export function closeToRight(target: string, deps: ReturnType<typeof sessionCloseDeps>) {
  const closing = closableRight(target, deps)
  if (closing.length === 0) return
  const visible = deps.visibleTabId()
  if (visible != null && closing.includes(visible)) deps.selectSessionTab(target)
  for (const id of closing) deps.sessionClose(id)
}
