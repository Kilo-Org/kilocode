type Snapshot = {
  key: string
  run: () => Promise<void>
}

export function sender(report: (err: unknown) => void) {
  let current: Snapshot | undefined
  let next: Snapshot | undefined
  let last: string | undefined

  async function drain() {
    const item = next
    if (!item) return
    next = undefined
    current = item
    try {
      await item.run()
      last = item.key
    } catch (err) {
      report(err)
    }
    current = undefined
    if (next) void drain()
  }

  return {
    push(item: Snapshot, force = false) {
      if (!force && item.key === last && !current) return
      if (!force && item.key === current?.key && !next) return
      next = item
      if (!current) void drain()
    },
  }
}
