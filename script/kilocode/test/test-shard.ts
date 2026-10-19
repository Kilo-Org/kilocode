export * as TestShard from "./test-shard"

/** One shard of a test run: `index` (1-based) of `total`. */
export type Info = {
  index: number
  total: number
}

/** Parse an `N/M` shard specification, for example the value of `KILO_TEST_SHARD`. */
export function parse(input?: string) {
  if (!input) return { ok: true as const, value: undefined }
  const match = input.match(/^(\d+)\/(\d+)$/)
  if (!match) return { ok: false as const, error: `Invalid test shard "${input}"; expected N/M` }

  const value: Info = { index: Number(match[1]), total: Number(match[2]) }
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

/** Heaviest first, ties by name, so every shard computes the same order. */
export function order(items: readonly string[], weight: (item: string) => number) {
  return items.slice().sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))
}

/** Longest-processing-time split: each item, heaviest first, goes to the shard with the least weight. */
export function split(items: readonly string[], weight: (item: string) => number, total: number) {
  const groups = Array.from({ length: total }, () => ({ items: [] as string[], weight: 0 }))
  for (const item of order(items, weight)) {
    const group = groups.reduce((best, next) => {
      if (next.weight < best.weight) return next
      if (next.weight === best.weight && next.items.length < best.items.length) return next
      return best
    })
    group.items.push(item)
    group.weight += weight(item)
  }
  return groups.map((group) => group.items)
}
