export function reorderTabs(tabs: readonly string[], from: string, to: string): string[] | undefined {
  if (from === to) return undefined
  const start = tabs.indexOf(from)
  const end = tabs.indexOf(to)
  if (start === -1 || end === -1) return undefined
  const result = [...tabs]
  result.splice(start, 1)
  result.splice(end, 0, from)
  return result
}

export function moveTab(tabs: readonly string[], id: string, offset: -1 | 1): string[] | undefined {
  const index = tabs.indexOf(id)
  const target = index + offset
  if (index === -1 || target < 0 || target >= tabs.length) return undefined
  return reorderTabs(tabs, id, tabs[target])
}
