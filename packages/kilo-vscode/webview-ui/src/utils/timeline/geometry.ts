export interface TimelineGeometryBar {
  bg: string
  width: number
  height: number
}

export interface TimelineGeometryItem extends TimelineGeometryBar {
  idx: number
  x: number
}

export interface TimelineGeometry {
  items: TimelineGeometryItem[]
  paths: Array<{ bg: string; d: string }>
  width: number
}

const shape = (x: number, width: number, height: number, max: number) => {
  const y = max - height
  const radius = Math.min(2, width / 2, height)
  return `M${x},${max}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + width - radius}Q${x + width},${y} ${x + width},${y + radius}V${max}Z`
}

export function geometry(bars: TimelineGeometryBar[], max: number, gap = 1): TimelineGeometry {
  const paths = new Map<string, string[]>()
  const items: TimelineGeometryItem[] = []
  let x = 0

  for (const [idx, bar] of bars.entries()) {
    const item = { ...bar, idx, x }
    items.push(item)
    const path = paths.get(bar.bg) ?? []
    path.push(shape(x, bar.width, bar.height, max))
    paths.set(bar.bg, path)
    x += bar.width + gap
  }

  return {
    items,
    paths: Array.from(paths, ([bg, parts]) => ({ bg, d: parts.join("") })),
    width: x,
  }
}

export function hit(items: TimelineGeometryItem[], x: number) {
  let low = 0
  let high = items.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const item = items[mid]!
    if (x < item.x) {
      high = mid - 1
      continue
    }
    if (x >= item.x + item.width) {
      low = mid + 1
      continue
    }
    return item.idx
  }

  return -1
}

export function navigate(index: number, count: number, key: string) {
  if (count === 0) return -1
  if (key === "Home") return 0
  if (key === "End") return count - 1
  if (key === "ArrowLeft") return Math.max(0, index < 0 ? count - 1 : index - 1)
  if (key === "ArrowRight") return Math.min(count - 1, index < 0 ? 0 : index + 1)
  return index
}
