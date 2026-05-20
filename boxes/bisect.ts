export function bisect<T>(
  arr: T[],
  key: string,
  cmp: (item: T) => string,
): { hit: boolean; idx: number } {
  let lo = 0
  let hi = arr.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const midKey = cmp(arr[mid])
    if (midKey === key) return { hit: true, idx: mid }
    if (midKey < key) lo = mid + 1
    else hi = mid - 1
  }
  return { hit: false, idx: lo }
}

export function sortedInsert<T>(
  arr: T[],
  item: T,
  cmp: (item: T) => string,
): T[] {
  const key = cmp(item)
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (cmp(arr[mid]) < key) lo = mid + 1
    else hi = mid
  }
  arr.splice(lo, 0, item)
  return arr
}
