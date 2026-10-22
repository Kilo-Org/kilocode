export interface CodeContext {
  id: string
  filePath: string
  startLine: number
  endLine: number
  text: string
}

export function codeContextLabel(context: CodeContext): string {
  const name = context.filePath.split(/[\\/]/).pop()
  const file = name && name.length > 0 ? name : context.filePath
  return `${file}:${context.startLine}-${context.endLine}`
}

export function formatCodeContext(context: CodeContext): string {
  return `${context.filePath}:${context.startLine}-${context.endLine}
\`\`\`
${context.text}
\`\`\``
}

export function formatCodeContexts(contexts: CodeContext[]): string {
  return contexts.map(formatCodeContext).join("\n\n")
}

function isSameCodeContext(a: CodeContext, b: CodeContext): boolean {
  return a.filePath === b.filePath && a.startLine === b.startLine && a.endLine === b.endLine && a.text === b.text
}

export function mergeCodeContexts(current: CodeContext[], incoming: CodeContext[]): CodeContext[] {
  if (incoming.length === 0) return current
  const next = [...current]
  for (const context of incoming) {
    if (!next.some((item) => isSameCodeContext(item, context))) next.push(context)
  }
  return next
}
