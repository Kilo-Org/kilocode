const bars = ["|", "｜"]
const gaps = ["_", "▁", " "]
const markers = [
  "</think>",
  ...bars.flatMap((bar) => gaps.map((gap) => `<${bar}end${gap}of${gap}thinking${bar}>`)),
]
const pattern = new RegExp(markers.map((marker) => marker.replace(/[|]/g, "\\|")).join("|"), "gi")

export function filter(state: Record<string, string>, id: string, text: string, done = false) {
  const value = ((state[id] ?? "") + text).replace(pattern, "")
  delete state[id]
  if (done) return value

  const index = value.lastIndexOf("<")
  if (index < 0) return value

  const tail = value.slice(index).toLowerCase()
  if (!markers.some((marker) => marker.toLowerCase().startsWith(tail))) return value
  state[id] = value.slice(index)
  return value.slice(0, index)
}
