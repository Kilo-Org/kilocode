interface Cost {
  input: number
  output: number
  cache: {
    read: number
    write: number
  }
}

export function fmtPrice(n: number): string {
  if (n === 0) return "Free"
  if (n < 0.01) return `$${n.toFixed(4)}/1M`
  return `$${n.toFixed(2)}/1M`
}

export function fmtCachedPrice(cost: Cost): string {
  const read = cost.cache.read
  if (read > 0) return fmtPrice(read)
  if (cost.input === 0) return fmtPrice(0)
  return "N/A"
}

export function avgPrice(cost: Cost): number {
  const read = cost.cache.read
  if (read > 0) return read * 0.7 + cost.input * 0.2 + cost.output * 0.1
  return cost.input * 0.9 + cost.output * 0.1
}

export function fmtContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
  return String(n)
}
