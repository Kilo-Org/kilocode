export function title(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}
