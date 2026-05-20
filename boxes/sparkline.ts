/**
 * sparkline.ts — Unicode braille sparkline rendering
 * Ported from abtop (MIT) btop-style braille graph
 * Deps: none
 */

// 5×5 lookup: [prev * 5 + cur], values 0–4
const BRAILLE: string[] = [
  " ", "⢀", "⢠", "⢰", "⢸",
  "⡀", "⣀", "⣠", "⣰", "⣸",
  "⡄", "⣄", "⣤", "⣴", "⣼",
  "⡆", "⣆", "⣦", "⣶", "⣾",
  "⡇", "⣇", "⣧", "⣷", "⣿",
]

/**
 * Render single-row braille sparkline from data (0.0–1.0).
 * Returns array of braille characters.
 */
export function sparkline(data: number[], width: number): string[] {
  if (data.length === 0 || width === 0) return Array(width).fill(" ")
  const needed = width * 2
  const sampled = data.length >= needed
    ? data.slice(-needed)
    : [...Array(needed - data.length).fill(0), ...data]
  const out: string[] = []
  for (let i = 0; i < width; i++) {
    const prev = Math.min(4, Math.max(0, Math.round(sampled[i * 2] * 4)))
    const cur = Math.min(4, Math.max(0, Math.round(sampled[i * 2 + 1] * 4)))
    out.push(BRAILLE[prev * 5 + cur])
  }
  return out
}

/**
 * Multi-row braille area graph (btop-style).
 * Returns string[] per row (top to bottom).
 */
export function brailleGraph(data: number[], width: number, height: number): string[][] {
  if (height === 0 || width === 0) return Array(height).fill([]).map(() => [])
  const totalVres = height * 4
  const needed = width * 2
  const sampled = data.length >= needed
    ? data.slice(-needed)
    : [...Array(needed - data.length).fill(0), ...data]
  const heights = sampled.map(v => Math.round(Math.min(1, Math.max(0, v)) * totalVres))
  const leftBits = [0x40, 0x04, 0x02, 0x01]
  const rightBits = [0x80, 0x20, 0x10, 0x08]
  const rows: string[][] = []
  for (let row = 0; row < height; row++) {
    const spans: string[] = []
    const invRow = height - 1 - row
    const baseY = invRow * 4
    for (let col = 0; col < width; col++) {
      const lh = heights[col * 2]
      const rh = heights[col * 2 + 1]
      let pattern = 0
      for (let dr = 0; dr < 4; dr++) {
        if (lh > baseY + dr) pattern |= leftBits[dr]
        if (rh > baseY + dr) pattern |= rightBits[dr]
      }
      spans.push(String.fromCharCode(0x2800 + pattern))
    }
    rows.push(spans)
  }
  return rows
}
