/**
 * human.ts — Human-readable formatting: duration, numbers, dates, truncate, plural
 * Zero deps.
 *
 * duration(150000) → "2m 30s"
 * compact(1500) → "1.5K"
 * truncate("hello world", 8) → "hello w…"
 */
export function title(s: string) { return s.replace(/\b\w/g, c => c.toUpperCase()) }

export function time(ms: number) { return new Date(ms).toLocaleTimeString(undefined, { timeStyle: "short" }) }

export function datetime(ms: number) { return `${time(ms)} · ${new Date(ms).toLocaleDateString()}` }

export function compact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1000) return (n / 1000).toFixed(1) + "K"
  return n.toString()
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`
  return `${Math.floor(ms / 3_600_000)}h`
}

export function truncate(s: string, len: number): string { return s.length <= len ? s : s.slice(0, len - 1) + "…" }

export function truncateMid(s: string, max = 35): string {
  if (s.length <= max) return s
  const pre = Math.ceil((max - 1) / 2)
  const suf = Math.floor((max - 1) / 2)
  return s.slice(0, pre) + "…" + s.slice(-suf)
}

export function plural(n: number, one: string, many: string): string { return (n === 1 ? one : many).replace("{}", String(n)) }

export function secsDuration(s: number): string {
  if (s <= 0) return ""
  if (s < 60) return `${s}s`
  if (s < 3600) { const m = Math.floor(s / 60); const r = s % 60; return r > 0 ? `${m}m ${r}s` : `${m}m` }
  if (s < 86400) { const h = Math.floor(s / 3600); const r = Math.floor((s % 3600) / 60); return r > 0 ? `${h}h ${r}m` : `${h}h` }
  const d = Math.floor(s / 86400); return d === 1 ? "~1 day" : `~${d} days`
}
