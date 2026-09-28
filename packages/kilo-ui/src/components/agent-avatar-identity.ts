export const COLORS = 8
const HALF = 15

/**
 * Assign colors to sibling agents in spawn order. Each agent keeps its hashed
 * color when it is still free; otherwise it takes the next free hue, so the
 * first eight siblings never share a color. After that, colors repeat and the
 * glyph shape is what tells agents apart.
 */
export function palette(ids: string[]) {
  const used = new Set<number>()
  const result = new Map<string, number>()
  for (const id of ids) {
    if (result.has(id)) continue
    const color = identity(id).color
    if (color == null) continue
    if (used.size >= COLORS) used.clear()
    const pick = Array.from({ length: COLORS }, (_, index) => (color + index) % COLORS).find((hue) => !used.has(hue))
    if (pick == null) continue
    used.add(pick)
    result.set(id, pick)
  }
  return result
}
const MIN = 6
const MAX = 9

function fnv(input: string, seed: number) {
  let hash = seed
  for (let index = 0; index < input.length; index++) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 16777619) >>> 0
  }
  return hash
}

// Mirror three columns into a five-column grid, like the loading spinner grid.
// The half-cell index is row * 3 + min(column, 4 - column).
function expand(half: (index: number) => boolean) {
  return Array.from({ length: 25 }, (_, index) => index).filter((index) => {
    const x = index % 5
    return half(Math.floor(index / 5) * 3 + Math.min(x, 4 - x))
  })
}

export function identity(id: string) {
  const known = id.trim() !== "" && id !== "unknown"
  if (!known) {
    const neutral = new Set([4, 7, 10, 13])
    return { color: undefined, cells: expand((index) => neutral.has(index)) }
  }
  const shape = fnv(id, 2166136261)
  const tone = fnv(id, 0x9747b28c)
  // Grow one connected shape from a center-column seed so the glyph reads as a
  // single figure instead of scattered dots. The bounded count avoids
  // near-empty and near-full blobs that look alike.
  const count = MIN + (tone % (MAX - MIN + 1))
  const rank = (index: number) => Math.imul(shape ^ (index + 1), 0x27d4eb2d) >>> 0
  const lit = new Set([2 + (shape % 5) * 3])
  while (lit.size < count) {
    const edge = Array.from({ length: HALF }, (_, index) => index).filter((index) => {
      if (lit.has(index)) return false
      // Half-cells 0 and 12 are the grid corners, which the round avatar does not draw.
      if (index === 0 || index === 12) return false
      const row = Math.floor(index / 3)
      const col = index % 3
      return (
        (col > 0 && lit.has(index - 1)) ||
        (col < 2 && lit.has(index + 1)) ||
        (row > 0 && lit.has(index - 3)) ||
        (row < 4 && lit.has(index + 3))
      )
    })
    const next = edge.reduce((best, index) => (rank(index) > rank(best) ? index : best))
    lit.add(next)
  }
  return { color: (tone >>> 4) % COLORS, cells: expand((index) => lit.has(index)) }
}
