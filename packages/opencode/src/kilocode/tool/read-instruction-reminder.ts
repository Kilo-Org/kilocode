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

const takeUtf8Prefix = (value: string, maxBytes: number) =>
  new TextDecoder("utf-8").decode(Buffer.from(value, "utf-8").subarray(0, Math.max(0, maxBytes))).replace(/\uFFFD$/, "")

const omittedNote = (paths: readonly string[]) =>
  `[Additional instructions omitted because the Read output budget was exhausted. Full instruction files not delivered: ${paths.join(", ")}. Read those files directly if needed.]`

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
  if (noteBudget <= 0) {
    return {
      output: body ? `${PREFIX}${body}${CLOSE}` : "",
      loaded: delivered.map((item) => item.filepath),
      truncated: true,
    }
  }

  const note = takeUtf8Prefix(omittedNote(omitted), noteBudget)
  return {
    output: `${PREFIX}${notePrefix}${note}${CLOSE}`,
    loaded: delivered.map((item) => item.filepath),
    truncated: true,
  }
}
