export function switchProject(opts: {
  id: string | undefined
  current: () => string | undefined
  set: (id: string | undefined) => void
  first: () => void
  close: () => void
  hide: () => void
  history: () => void
  reset: () => void
}): "first" | "switched" | "same" {
  const previous = opts.current()
  if (opts.id === previous) return "same"
  opts.set(opts.id)
  if (previous === undefined) {
    opts.first()
    return "first"
  }
  opts.close()
  opts.hide()
  opts.history()
  opts.reset()
  return "switched"
}
