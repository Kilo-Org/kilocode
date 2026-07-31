export namespace TestShard {
  export type Info = {
    index: number
    total: number
  }

  export function parse(input?: string) {
    if (!input) return { ok: true as const, value: undefined }
    const match = input.match(/^(\d+)\/(\d+)$/)
    if (!match) return { ok: false as const, error: `Invalid test shard "${input}"; expected N/M` }

    const value = { index: Number(match[1]), total: Number(match[2]) }
    if (
      !Number.isSafeInteger(value.index) ||
      !Number.isSafeInteger(value.total) ||
      value.total < 1 ||
      value.total > 1_000 ||
      value.index < 1 ||
      value.index > value.total
    ) {
      return { ok: false as const, error: `Invalid test shard "${input}"; expected 1 <= N <= M <= 1000` }
    }
    return { ok: true as const, value }
  }

  export function order(files: readonly string[], weight: (file: string) => number) {
    return files.slice().sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))
  }

  export function split(files: readonly string[], weight: (file: string) => number, total: number) {
    const groups = Array.from({ length: total }, () => ({ files: [] as string[], weight: 0 }))
    for (const file of order(files, weight)) {
      const group = groups.reduce((best, item) => {
        if (item.weight < best.weight) return item
        if (item.weight === best.weight && item.files.length < best.files.length) return item
        return best
      })
      group.files.push(file)
      group.weight += weight(file)
    }
    return groups.map((group) => group.files)
  }

  // Build a runtime-weighted sharding function from measured per-file durations
  // (seconds). Files with a positive measured duration use it directly; unknown
  // or sub-resolution files are estimated from their byte size scaled to the
  // measured set, floored so LPT never clusters zero-weight files into one shard.
  // Returns a plain size weight when no timings are supplied (preserves prior
  // behavior on platforms without a timings manifest).
  export function timedWeight(
    timings: Record<string, number> | undefined,
    size: (file: string) => number,
  ): (file: string) => number {
    if (!timings) return size
    let totalT = 0
    let totalS = 0
    for (const [file, t] of Object.entries(timings)) {
      if (t <= 0) continue
      let s: number
      try {
        s = size(file)
      } catch {
        continue
      }
      totalT += t
      totalS += s
    }
    if (totalS <= 0) return size
    const scale = totalT / totalS
    return (file: string) => {
      const t = timings[file]
      return t != null && t > 0 ? t : Math.max(size(file) * scale, 0.5)
    }
  }
}
