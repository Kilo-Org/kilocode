function isPrompt(line: string): boolean {
  if (line.startsWith("PS ") && line.endsWith(">")) return true
  return /[$#>%❯]$/.test(line)
}

export function trimTerminalOutput(content: string): string {
  const text = content.trim()
  if (!text) return ""

  const lines = text.split("\n")
  if (lines.length < 2) return text

  const last = lines[lines.length - 1]?.trim()
  if (!last) return text
  if (!isPrompt(last)) return text

  let i = lines.length - 2
  while (i >= 0 && !lines[i]!.trim().startsWith(last)) {
    i--
  }

  if (i < 0) return text
  return lines.slice(i, -1).join("\n")
}
