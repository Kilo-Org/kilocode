const LING_EXCLUDES = ["kling", "bling", "spelling", "multilingual"]

export function isLing(id: string) {
  const lower = id.toLowerCase()
  return lower.includes("ling") && !LING_EXCLUDES.some((s) => lower.includes(s))
}

export function isGpt6(id: string) {
  const name = id.split("/").at(-1)?.toLowerCase() ?? ""
  const major = Number(name.match(/^gpt-(\d+)(?:\.\d+)?(?:-|$)/)?.at(1))
  return major >= 6 || name === "gpt-astra-latest"
}
