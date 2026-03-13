export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString()
}
