export function thinkingRows(variants: string[], clear: boolean) {
  if (variants.length === 0) return []
  return clear ? [undefined, ...variants] : variants
}
