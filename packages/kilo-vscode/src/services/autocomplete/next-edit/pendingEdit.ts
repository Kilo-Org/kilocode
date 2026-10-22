type Document = {
  lineCount: number
  end(line: number): number
}

type Insertion = {
  diffStartLine: number
  replacement: string
}

type Replacement = Insertion & {
  diffEndLine: number
  removesLines: boolean
}

export function planInsertion(input: Insertion, document: Document) {
  if (input.diffStartLine < document.lineCount) {
    return { line: input.diffStartLine, character: 0, text: input.replacement }
  }
  const line = Math.max(0, document.lineCount - 1)
  const text = input.replacement.endsWith("\n") ? input.replacement.slice(0, -1) : input.replacement
  return { line, character: document.end(line), text: `\n${text}` }
}

export function planReplacement(input: Replacement, document: Document) {
  const end = { line: input.diffEndLine, character: document.end(input.diffEndLine) }
  if (!input.removesLines) {
    return { start: { line: input.diffStartLine, character: 0 }, end, text: input.replacement }
  }
  if (input.diffEndLine < document.lineCount - 1) {
    return {
      start: { line: input.diffStartLine, character: 0 },
      end: { line: input.diffEndLine + 1, character: 0 },
      text: input.replacement,
    }
  }
  if (input.diffStartLine === 0) return { start: { line: 0, character: 0 }, end, text: input.replacement }
  return {
    start: { line: input.diffStartLine - 1, character: document.end(input.diffStartLine - 1) },
    end,
    text: input.replacement,
  }
}
