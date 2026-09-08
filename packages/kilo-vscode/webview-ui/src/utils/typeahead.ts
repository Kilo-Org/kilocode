/**
 * Type-ahead focus helper for simple listbox-style popovers (agent/mode selector,
 * reasoning variant selector). Mirrors native `<select>`/ARIA listbox behavior:
 * printable keys accumulate into a short-lived search buffer and focus jumps to the
 * first item whose label starts with that buffer. If the accumulated buffer stops
 * matching anything, it restarts from just the latest key so focus keeps moving
 * toward the closest match instead of getting stuck.
 *
 * Matching is word-wise so a typed space advances to the next word of the label:
 * "up me" reaches "Upstream Merge" without having to spell out the first word.
 */

const RESET_MS = 700

export function createTypeahead(getLabels: () => string[]) {
  let buffer = ""
  let timer: ReturnType<typeof setTimeout> | undefined

  function reset() {
    buffer = ""
    clearTimeout(timer)
    timer = undefined
  }

  /** True while a search buffer is still pending, i.e. the user is mid-search. */
  function active() {
    return buffer.length > 0
  }

  /** Each whitespace-separated chunk of the needle must prefix the label word at the same position. */
  function hit(label: string, needle: string) {
    const words = label.toLowerCase().split(/\s+/)
    const typed = needle.split(/\s+/)
    if (typed.length > words.length) return false
    return typed.every((word, i) => (words.at(i) ?? "").startsWith(word))
  }

  function match(needle: string, labels: string[]) {
    return labels.findIndex((label) => hit(label, needle))
  }

  /** Feed one printable character. Returns the item index to focus, or -1 if nothing matches. */
  function type(char: string): number {
    clearTimeout(timer)
    timer = setTimeout(reset, RESET_MS)

    const labels = getLabels()
    const extended = (buffer + char).toLowerCase()
    const extendedIdx = match(extended, labels)
    if (extendedIdx >= 0) {
      buffer += char
      return extendedIdx
    }

    // A bare space carries no search intent of its own: splitting it alone yields
    // empty word chunks that trivially prefix-match any multi-word label. Only
    // restart the buffer from a non-whitespace character.
    if (/^\s$/.test(char)) {
      reset()
      return -1
    }

    const restarted = char.toLowerCase()
    const restartedIdx = match(restarted, labels)
    buffer = restartedIdx >= 0 ? char : ""
    return restartedIdx
  }

  return { type, reset, active }
}

/** True for a single printable character typed without a modifier combo. */
export function isTypeaheadChar(e: KeyboardEvent) {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
}
