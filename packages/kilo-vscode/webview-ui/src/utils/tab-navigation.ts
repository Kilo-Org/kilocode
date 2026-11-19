export function tabForKey<const T extends string>(ids: readonly T[], id: T, key: string): T | undefined {
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

/** Let a selected destination take focus after the menu releases its focus trap. Escape still restores the trigger. */
export function createTabMenuAction() {
  let action: (() => void) | undefined
  return {
    select: (next: () => void) => {
      action = next
    },
    close: (event: Event) => {
      if (!action) return
      event.preventDefault()
      const next = action
      action = undefined
      next()
    },
  }
}

export function handleTabKey(input: {
  ids: readonly string[]
  id: string
  event: KeyboardEvent
  select: (id: string) => void
  activate?: (id: string) => void
  root: ParentNode | null
}) {
  if (input.event.target !== input.event.currentTarget) return
  if (input.event.key === "Enter" || input.event.key === " ") {
    input.event.preventDefault()
    const activate = input.activate ?? input.select
    activate(input.id)
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
  /** Enter/Space enters the panel; arrows only select and keep focus on the strip. */
  activate?: (id: string) => void
  root?: () => ParentNode | null
  fallback?: () => void
}) {
  const root = () => input.root?.() ?? document
  const fallback = input.fallback ?? focusPrompt
  const restore = () => focusSelectedTab(root(), fallback)
  return {
    restore,
    key: (id: string, event: KeyboardEvent) =>
      handleTabKey({ ids: input.ids(), id, event, select: input.select, activate: input.activate, root: root() }),
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
