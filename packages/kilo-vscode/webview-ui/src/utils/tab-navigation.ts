export function tabForKey(ids: readonly string[], id: string, key: string): string | undefined {
  const index = ids.indexOf(id)
  if (index === -1 || ids.length === 0) return undefined
  if (key === "ArrowLeft") return ids[(index - 1 + ids.length) % ids.length]
  if (key === "ArrowRight") return ids[(index + 1) % ids.length]
  if (key === "Home") return ids[0]
  if (key === "End") return ids[ids.length - 1]
  return undefined
}

export function focusTabElement(root: ParentNode | null, id: string, fallback?: () => void) {
  requestAnimationFrame(() => {
    const el = root?.querySelector(`[data-tab-id="${id}"] [role="tab"]`)
    if (el instanceof HTMLElement) {
      el.focus()
      return
    }
    fallback?.()
  })
}

export function focusSelectedTab(root: ParentNode | null, fallback?: () => void) {
  requestAnimationFrame(() => {
    const el = root?.querySelector('[role="tab"][aria-selected="true"]')
    if (el instanceof HTMLElement) {
      el.focus()
      return
    }
    fallback?.()
  })
}

export const focusPrompt = () => window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { restore: true } }))

export function handleTabKey(input: {
  ids: readonly string[]
  id: string
  event: KeyboardEvent
  select: (id: string) => void
  root: ParentNode | null
}) {
  if (input.event.target !== input.event.currentTarget) return
  if (input.event.key === "Enter" || input.event.key === " ") {
    input.event.preventDefault()
    input.select(input.id)
    return
  }
  if (input.event.metaKey || input.event.ctrlKey || input.event.shiftKey || input.event.altKey) return
  const next = tabForKey(input.ids, input.id, input.event.key)
  if (!next) return
  input.event.preventDefault()
  input.select(next)
  focusTabElement(input.root, next)
}

export function createTabFocus(input: {
  ids: () => readonly string[]
  select: (id: string) => void
  root?: () => ParentNode | null
  fallback?: () => void
}) {
  const root = () => input.root?.() ?? document
  const fallback = input.fallback ?? focusPrompt
  const restore = () => focusSelectedTab(root(), fallback)
  return {
    restore,
    key: (id: string, event: KeyboardEvent) =>
      handleTabKey({ ids: input.ids(), id, event, select: input.select, root: root() }),
    run: (action: () => void) => {
      action()
      restore()
    },
    middle: (event: MouseEvent, action: () => void) => {
      action()
      if (event.button === 1) restore()
    },
  }
}
