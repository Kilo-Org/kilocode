/**
 * tally.ts — Generic numeric accumulator by category
 * Zero deps. Closure state.
 *
 * const t = create()
 * t.add("gpt-4", { tokens: 100, cost: 0.05 })
 * t.total("gpt-4", "cost") → 0.05
 * t.all() → { "gpt-4": { tokens: 100, cost: 0.05 } }
 */

type Record = Record<string, number>

export type Tally = {
  add: (key: string, vals: Record) => void
  get: (key: string) => Record | undefined
  all: () => Record<string, Record>
  sum: (field: string) => number
  reset: () => void
}

export function create(): Tally {
  const data: Record<string, Record> = {}

  return {
    add(key: string, vals: Record) {
      if (!data[key]) data[key] = {}
      for (const [k, v] of Object.entries(vals)) {
        data[key][k] = (data[key][k] ?? 0) + v
      }
    },
    get(key: string) { return data[key] },
    all() { return { ...data } },
    sum(field: string) {
      return Object.values(data).reduce((s, r) => s + (r[field] ?? 0), 0)
    },
    reset() { for (const k of Object.keys(data)) delete data[k] },
  }
}
