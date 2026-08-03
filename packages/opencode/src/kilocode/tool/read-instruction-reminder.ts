export type InstructionReminder = {
  output: string
  loaded: string[]
  omitted: string[]
  truncated: boolean
}

export type LoadedInstruction = {
  filepath: string
  content: string
}

const PREFIX = "\n\n<system-reminder>\n"
const CLOSE = "\n</system-reminder>"
const SEPARATOR = "\n\n"

const byteLength = (value: string) => Buffer.byteLength(value, "utf-8")

const NOTE_PREFIX =
  "[Additional instructions omitted because the Read output budget was exhausted. Full instruction files not delivered: "
const NOTE_SUFFIX = ". Read those files directly if needed.]"
const FALLBACK = "[Some instruction files were omitted.]"

const omittedSummary = (paths: readonly string[], maxBytes: number) => {
  if (byteLength(NOTE_PREFIX + NOTE_SUFFIX) > maxBytes) return byteLength(FALLBACK) <= maxBytes ? FALLBACK : ""

  const selected: string[] = []
  for (const path of paths) {
    const remaining = paths.length - selected.length - 1
    const more = remaining > 0 ? `, and ${remaining} more` : ""
    const candidate = NOTE_PREFIX + [...selected, path].join(", ") + more + NOTE_SUFFIX
    if (byteLength(candidate) > maxBytes) break
    selected.push(path)
  }
  if (selected.length === 0) return byteLength(FALLBACK) <= maxBytes ? FALLBACK : ""
  const remaining = paths.length - selected.length
  return NOTE_PREFIX + selected.join(", ") + (remaining > 0 ? `, and ${remaining} more` : "") + NOTE_SUFFIX
}

export function formatInstructionReminder(
  loaded: readonly LoadedInstruction[],
  options: { maxBytes: number },
): InstructionReminder {
  if (loaded.length === 0) return { output: "", loaded: [], omitted: [], truncated: false }

  const maxBytes = Math.max(0, options.maxBytes)
  const openCloseBytes = byteLength(PREFIX + CLOSE)
  if (maxBytes < openCloseBytes) {
    return { output: "", loaded: [], omitted: loaded.map((item) => item.filepath), truncated: true }
  }

  const delivered: LoadedInstruction[] = []
  let body = ""
  for (const item of loaded) {
    const next = body ? `${body}${SEPARATOR}${item.content}` : item.content
    const remaining = loaded.slice(delivered.length + 1).map((entry) => entry.filepath)
    const prefix = remaining.length > 0 ? `${next}${SEPARATOR}` : next
    const budget = maxBytes - byteLength(PREFIX + prefix + CLOSE)
    const note = remaining.length > 0 ? omittedSummary(remaining, budget) : ""
    if (remaining.length > 0 && !note) break
    const suffix = note ? `${SEPARATOR}${note}` : ""
    if (byteLength(PREFIX + next + suffix + CLOSE) > maxBytes) break
    body = next
    delivered.push(item)
  }

  const omitted = loaded.slice(delivered.length).map((item) => item.filepath)
  if (omitted.length === 0) {
    return {
      output: `${PREFIX}${body}${CLOSE}`,
      loaded: delivered.map((item) => item.filepath),
      omitted,
      truncated: false,
    }
  }

  const prefix = body ? `${body}${SEPARATOR}` : ""
  const budget = maxBytes - byteLength(PREFIX + prefix + CLOSE)
  const note = omittedSummary(omitted, budget)
  return {
    output: note ? `${PREFIX}${prefix}${note}${CLOSE}` : body ? `${PREFIX}${body}${CLOSE}` : "",
    loaded: delivered.map((item) => item.filepath),
    omitted,
    truncated: true,
  }
}
