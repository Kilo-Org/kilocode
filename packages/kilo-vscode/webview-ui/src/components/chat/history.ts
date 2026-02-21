const entries: string[] = []
let idx = -1
let draft = ""

export function addHistory(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return
  if (entries[0] === trimmed) return
  entries.unshift(trimmed)
  if (entries.length > 100) entries.pop()
}

export function navigate(direction: "up" | "down", current: string): { text: string } | null {
  if (direction === "up") {
    if (entries.length === 0) return null
    if (idx === -1) {
      draft = current
      idx = 0
      return { text: entries[0] }
    }
    if (idx < entries.length - 1) {
      idx++
      return { text: entries[idx] }
    }
    return null
  }
  if (idx === -1) return null
  if (idx > 0) {
    idx--
    return { text: entries[idx] }
  }
  const saved = draft
  idx = -1
  draft = ""
  return { text: saved }
}

export function reset() {
  idx = -1
  draft = ""
}

export function canNavigate(direction: "up" | "down", textarea: HTMLTextAreaElement): boolean {
  const cursor = textarea.selectionStart ?? textarea.value.length
  if (!textarea.value.includes("\n")) return true
  if (direction === "up") return !textarea.value.slice(0, cursor).includes("\n")
  return !textarea.value.slice(cursor).includes("\n")
}
