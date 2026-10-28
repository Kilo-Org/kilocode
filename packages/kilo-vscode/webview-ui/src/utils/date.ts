export function formatRelativeDate(iso: string): string {
  const now = Date.now()
  const parsed = Date.parse(iso)
  const then = Number.isFinite(parsed) ? parsed : now
  const diff = now - then

  if (diff <= 0) return "just now"

  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return "just now"

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  const months = Math.floor(days / 30)
  return `${months}mo ago`
}
