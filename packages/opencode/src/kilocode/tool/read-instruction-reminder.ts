export type InstructionReminder = {
  output: string
  loaded: string[]
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

const omittedNote = (paths: readonly string[]) =>
  `[Additional instructions omitted because the Read output budget was exhausted. Full instruction files not delivered: ${paths.join(", ")}. Read those files directly if needed.]`

const omittedSummary = (paths: readonly string[], maxBytes: number) => {
  const prefix =
    "[Additional instructions omitted because the Read output budget was exhausted. Full instruction files not delivered: "
  const suffix = ". Read those files directly if needed.]"
  if (byteLength(prefix + suffix) > maxBytes) return ""

  const selected: string[] = []
  for (const path of paths) {
    const remaining = paths.length - selected.length - 1
    const more = remaining > 0 ? `, and ${remaining} more` : ""
    const candidate = prefix + [...selected, path].join(", ") + more + suffix
    if (byteLength(candidate) > maxBytes) break
    selected.push(path)
  }
  if (selected.length === 0) return ""
  const remaining = paths.length - selected.length
  return prefix + selected.join(", ") + (remaining > 0 ? `, and ${remaining} more` : "") + suffix
}

export function formatInstructionReminder(
  loaded: readonly LoadedInstruction[],
  options: { maxBytes: number },
): InstructionReminder {
  if (loaded.length === 0) return { output: "", loaded: [], truncated: false }

  const maxBytes = Math.max(0, options.maxBytes)
  const openCloseBytes = byteLength(PREFIX + CLOSE)
  if (maxBytes <= openCloseBytes) return { output: "", loaded: [], truncated: true }

  const delivered: LoadedInstruction[] = []
  let body = ""
  for (const item of loaded) {
    const nextBody = body ? `${body}${SEPARATOR}${item.content}` : item.content
    const remaining = loaded.slice(delivered.length + 1).map((entry) => entry.filepath)
    const candidateNote = remaining.length > 0 ? `${SEPARATOR}${omittedNote(remaining)}` : ""
    if (byteLength(PREFIX + nextBody + candidateNote + CLOSE) > maxBytes) break
    body = nextBody
    delivered.push(item)
  }

  const omitted = loaded.slice(delivered.length).map((item) => item.filepath)
  if (omitted.length === 0)
    return { output: `${PREFIX}${body}${CLOSE}`, loaded: delivered.map((item) => item.filepath), truncated: false }

  const notePrefix = body ? `${body}${SEPARATOR}` : ""
  const noteBudget = maxBytes - byteLength(PREFIX + notePrefix + CLOSE)
  const note = omittedSummary(omitted, noteBudget)
  return {
    output: note ? `${PREFIX}${notePrefix}${note}${CLOSE}` : body ? `${PREFIX}${body}${CLOSE}` : "",
    loaded: delivered.map((item) => item.filepath),
    truncated: true,
  }
}
