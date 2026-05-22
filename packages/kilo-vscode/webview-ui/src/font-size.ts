const DEFAULT_SIZE = 13
const SIZES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]

export function clampFontSize(size: number) {
  if (!Number.isFinite(size)) return DEFAULT_SIZE
  return Math.min(24, Math.max(10, Math.round(size)))
}

export function readFontSize() {
  if (typeof window === "undefined") return DEFAULT_SIZE
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--kilo-font-size-13")
  const size = Number.parseFloat(raw)
  return clampFontSize(size)
}

export function applyFontSize(size: number) {
  const base = clampFontSize(size)
  const root = document.documentElement
  for (const token of SIZES) {
    root.style.setProperty(`--kilo-font-size-${token}`, `${(base * token) / DEFAULT_SIZE}px`)
  }
  root.style.setProperty("--kilo-font-scale", String(base / DEFAULT_SIZE))
  root.style.setProperty("--font-size-x-small", "var(--kilo-font-size-10)")
  root.style.setProperty("--font-size-small", "var(--kilo-font-size-11)")
  root.style.setProperty("--font-size-base", "var(--kilo-font-size-13)")
  root.style.setProperty("--font-size-large", "var(--kilo-font-size-16)")
}
