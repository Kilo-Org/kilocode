export const COLORS = 8
const HALF = 15
const ALTERNATES = 64

export type AvatarIdentity = { color: number | undefined; cells: number[] }
type ColoredIdentity = AvatarIdentity & { color: number }

/**
 * Assign colors to sibling agents in spawn order. Each agent keeps its hashed
 * color when it is still free; otherwise it takes the next free hue, so the
 * first eight siblings never share a color. After that, colors repeat and the
 * glyph shape is what tells agents apart.
 *
 * A repeated color is only a problem when the glyph repeats too. The first
 * sibling to hit such a pair moves to another hue for the same glyph. Only
 * a glyph that already uses every hue gets a different glyph.
 */
export function palette(ids: string[]) {
  const used = new Set<number>()
  const result = new Map<string, AvatarIdentity>()
  const pairs = new Map<string, Set<number>>()
  for (const id of ids) {
    if (result.has(id)) continue
    const base = identity(id)
    const color = base.color
    if (color == null) continue
    if (used.size >= COLORS) used.clear()
    const pick = Array.from({ length: COLORS }, (_, index) => (color + index) % COLORS).find((hue) => !used.has(hue))
    if (pick == null) continue
    // Keep the usual hue sequence independent of pair repairs, so a repair doesn't recolor later siblings.
    used.add(pick)
    const avatar = uniqueIdentity(id, { color: pick, cells: base.cells }, pairs, used)
    const glyph = avatar.cells.join(",")
    const hues = pairs.get(glyph) ?? new Set<number>()
    hues.add(avatar.color)
    pairs.set(glyph, hues)
    result.set(id, avatar)
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

export function identity(id: string): AvatarIdentity {
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

function uniqueIdentity(id: string, base: ColoredIdentity, pairs: Map<string, Set<number>>, used: Set<number>) {
  if (!pairs.get(base.cells.join(","))?.has(base.color)) return base

  const hues = Array.from({ length: COLORS }, (_, index) => (base.color + index) % COLORS)
  for (let attempt = 0; attempt <= ALTERNATES; attempt++) {
    // Alternate seeds keep the normal connected glyph style, including when the base glyph is fully symmetric.
    const cells = attempt === 0 ? base.cells : identity(`${id}:${attempt}`).cells
    const taken = pairs.get(cells.join(","))
    const free = hues.filter((hue) => !taken?.has(hue))
    const color = free.find((hue) => !used.has(hue)) ?? free[0]
    if (color !== undefined) return { color, cells }
  }
  return base
}
