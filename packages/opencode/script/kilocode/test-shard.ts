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
}
