export function time(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { timeStyle: "short" })
}

export function datetime(ts: number): string {
  return `${time(ts)} · ${new Date(ts).toLocaleDateString()}`
}

export function todayOrFull(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const same =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return same ? time(ts) : datetime(ts)
}
