export function tabId(id: string): string {
  return `am-tab-${encodeURIComponent(id)}`
}

export function panelId(id: string): string {
  return `am-panel-${encodeURIComponent(id)}`
}

export function nextTab(ids: string[], id: string): string | undefined {
  const idx = ids.indexOf(id)
  if (idx < 0) return undefined
  return ids[idx + 1] ?? ids[idx - 1]
}

export function handleTabKeyDown(e: KeyboardEvent) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  if (!(e.currentTarget instanceof HTMLElement)) return

  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.click()
    return
  }

  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return
  const list = e.currentTarget.closest('[role="tablist"]')
  if (!(list instanceof HTMLElement)) return
  const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'))
  const idx = tabs.indexOf(e.currentTarget)
  if (idx < 0 || tabs.length === 0) return
  const next =
    e.key === "Home"
      ? tabs[0]
      : e.key === "End"
        ? tabs[tabs.length - 1]
        : tabs[(idx + (e.key === "ArrowLeft" ? tabs.length - 1 : 1)) % tabs.length]
  if (!next) return

  e.preventDefault()
  e.stopPropagation()
  next.focus()
  next.click()
}

export function restoreTabFocus(target: EventTarget | null) {
  if (!(target instanceof HTMLElement) || document.activeElement !== target) return
  const list = target.closest('[role="tablist"]')
  if (!(list instanceof HTMLElement)) return
  requestAnimationFrame(() => list.querySelector<HTMLElement>('[role="tab"][tabindex="0"]')?.focus())
}
