export function openCloudTab(ids: string[], id: string) {
  if (ids.includes(id)) return ids
  return [...ids, id]
}

export function closeCloudTab(ids: string[], id: string) {
  const index = ids.indexOf(id)
  if (index < 0) return { ids, selected: undefined }
  const next = ids.filter((item) => item !== id)
  return { ids: next, selected: next[Math.min(index, next.length - 1)] }
}
