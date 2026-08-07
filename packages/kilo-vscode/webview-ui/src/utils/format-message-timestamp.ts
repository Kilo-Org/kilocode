/** Compact completion stamp for assistant messages (display-layer only). */

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r ? `${m}m ${r}s` : `${m}m`
}

export function formatCompletedAt(ms: number, locale: string): string {
  const d = new Date(ms)
  const wd = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d)
  const pad = (n: number) => String(n).padStart(2, "0")
  const yy = String(d.getFullYear()).slice(-2)
  const date = `${yy}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return `${wd} ${date} ${time}`
}

export function messageDurationMs(time: { created: number; completed?: number }): number | undefined {
  if (time.completed === undefined) return undefined
  return Math.max(0, time.completed - time.created)
}
