type Position = {
  line: number
  character: number
}

type Selection = {
  isEmpty: boolean
  start: Position
  end: Position
}

type Editor = {
  document: {
    uri: {
      toString(): string
    }
  }
  selection: Selection
}

export function editorContextUrl(editor: Editor): string {
  const uri = editor.document.uri.toString()
  const selection = editor.selection
  if (selection.isEmpty) return uri

  const start = Math.min(selection.start.line, selection.end.line) + 1
  const rawEnd = Math.max(selection.start.line, selection.end.line) + 1
  const end =
    selection.end.character === 0 && selection.end.line > selection.start.line ? Math.max(start, rawEnd - 1) : rawEnd

  return `${uri}?start=${start}&end=${end}`
}
