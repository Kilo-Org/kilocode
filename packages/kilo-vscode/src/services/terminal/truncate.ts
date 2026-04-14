export const TERMINAL_OUTPUT_LINE_LIMIT = 500
export const TERMINAL_OUTPUT_CHARACTER_LIMIT = 50_000

export type TerminalLimitOptions = {
  lineLimit?: number
  characterLimit?: number
}

export type TerminalOutput = {
  content: string
  truncated: boolean
}

export function truncateTerminalOutput(content: string, opts: TerminalLimitOptions = {}): TerminalOutput {
  const chars = opts.characterLimit ?? TERMINAL_OUTPUT_CHARACTER_LIMIT
  if (chars > 0 && content.length > chars) {
    const before = Math.floor(chars * 0.2)
    const after = chars - before
    const omitted = content.length - chars
    return {
      content: `${content.slice(0, before)}\n[...${omitted} characters omitted...]\n${content.slice(-after)}`,
      truncated: true,
    }
  }

  const limit = opts.lineLimit ?? TERMINAL_OUTPUT_LINE_LIMIT
  if (limit <= 0) return { content, truncated: false }

  const lines = content.split("\n")
  if (lines.length <= limit) return { content, truncated: false }

  const before = Math.floor(limit * 0.2)
  const after = limit - before
  const omitted = lines.length - limit
  return {
    content: `${lines.slice(0, before).join("\n")}\n\n[...${omitted} lines omitted...]\n\n${lines.slice(-after).join("\n")}`,
    truncated: true,
  }
}
