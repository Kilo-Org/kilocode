type Stamped = { id: string; time: { created: number } }

export function older(a: Stamped, b: Stamped) {
  if (a.time.created !== b.time.created) return a.time.created - b.time.created
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function at(list: readonly { id: string }[], id: string) {
  const index = list.findIndex((item) => item.id === id)
  return { found: index >= 0, index }
}

export function slot<T extends Stamped>(list: readonly T[], item: T) {
  const hit = at(list, item.id)
  if (hit.found) return hit
  const index = list.findIndex((entry) => older(item, entry) < 0)
  return { found: false, index: index < 0 ? list.length : index }
}

export function recent<T extends Stamped>(list: readonly T[], cap = 100) {
  return list.toSorted(older).slice(-cap)
}
