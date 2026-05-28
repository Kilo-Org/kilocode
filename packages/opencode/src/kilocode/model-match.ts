const LING_EXCLUDES = ["kling", "bling", "spelling", "multilingual"]

export function isLing(id: string) {
  const lower = id.toLowerCase()
  return lower.includes("ling") && !LING_EXCLUDES.some((s) => lower.includes(s))
}
