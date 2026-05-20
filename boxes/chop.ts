export function chop(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "…"
}

export function chopMid(s: string, max = 35): string {
  if (s.length <= max) return s
  const half = max - 1
  const a = Math.ceil(half / 2)
  const b = Math.floor(half / 2)
  return s.slice(0, a) + "…" + s.slice(-b)
}
