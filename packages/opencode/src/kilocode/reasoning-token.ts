const bars = ["|", "｜"]
const gaps = ["_", "▁", " "]
const markers = [
  "</think>",
  ...bars.flatMap((bar) => gaps.map((gap) => `<${bar}end${gap}of${gap}thinking${bar}>`)),
]
export type State = Map<string, string | null>

export function filter(state: State, id: string, text: string, done = false) {
  const pending = state.get(id)
  if (pending === null) return text

  const value = (pending ?? "") + text
  if (done) {
    state.delete(id)
    return value
  }

  const lower = value.toLowerCase()
  const marker = markers.find((item) => lower.startsWith(item.toLowerCase()))
  if (marker) {
    state.set(id, null)
    return value.slice(marker.length)
  }
  if (markers.some((item) => item.toLowerCase().startsWith(lower))) {
    state.set(id, value)
    return ""
  }

  state.set(id, null)
  return value
}
