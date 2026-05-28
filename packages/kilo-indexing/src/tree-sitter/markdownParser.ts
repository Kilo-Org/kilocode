import type { QueryCapture } from "web-tree-sitter"

interface MockNode {
  startPosition: {
    row: number
  }
  endPosition: {
    row: number
  }
  text: string
  parent?: MockNode
}

interface MockCapture {
  node: MockNode
  name: string
  patternIndex: number
}

/**
 * Parse a markdown file and extract headers and section line ranges.
 * Returns mock captures compatible with tree-sitter's QueryCapture format.
 */
export function parseMarkdown(content: string): QueryCapture[] {
  if (!content || content.trim() === "") {
    return []
  }

  const lines = content.split("\n")
  const captures: MockCapture[] = []

  const atxHeaderRegex = /^(#{1,6})\s+(.+)$/
  const setextH1Regex = /^={3,}\s*$/
  const setextH2Regex = /^-{3,}\s*$/
  const validSetextTextRegex = /^\s*[^#<>!\[\]`\t]+[^\n]$/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // ATX headers (# Header)
    const atxMatch = line.match(atxHeaderRegex)
    if (atxMatch) {
      const level = atxMatch[1].length
      const text = atxMatch[2].trim()

      const node: MockNode = {
        startPosition: { row: i },
        endPosition: { row: i },
        text: text,
      }

      captures.push({
        node,
        name: `name.definition.header.h${level}`,
        patternIndex: 0,
      })

      captures.push({
        node,
        name: `definition.header.h${level}`,
        patternIndex: 0,
      })

      continue
    }

    // Setext headers (underlined)
    if (i > 0) {
      if (setextH1Regex.test(line) && validSetextTextRegex.test(lines[i - 1])) {
        const text = lines[i - 1].trim()

        const node: MockNode = {
          startPosition: { row: i - 1 },
          endPosition: { row: i },
          text: text,
        }

        captures.push({
          node,
          name: "name.definition.header.h1",
          patternIndex: 0,
        })

        captures.push({
          node,
          name: "definition.header.h1",
          patternIndex: 0,
        })

        continue
      }

      if (setextH2Regex.test(line) && validSetextTextRegex.test(lines[i - 1])) {
        const text = lines[i - 1].trim()

        const node: MockNode = {
          startPosition: { row: i - 1 },
          endPosition: { row: i },
          text: text,
        }

        captures.push({
          node,
          name: "name.definition.header.h2",
          patternIndex: 0,
        })

        captures.push({
          node,
          name: "definition.header.h2",
          patternIndex: 0,
        })

        continue
      }
    }
  }

  // Calculate section ranges
  captures.sort((a, b) => a.node.startPosition.row - b.node.startPosition.row)

  const headerCaptures: MockCapture[][] = []
  for (let i = 0; i < captures.length; i += 2) {
    if (i + 1 < captures.length) {
      headerCaptures.push([captures[i], captures[i + 1]])
    } else {
      headerCaptures.push([captures[i]])
    }
  }

  // Update end positions for section ranges
  for (let i = 0; i < headerCaptures.length; i++) {
    const headerPair = headerCaptures[i]

    if (i < headerCaptures.length - 1) {
      const nextHeaderStartRow = headerCaptures[i + 1][0].node.startPosition.row
      headerPair.forEach((capture) => {
        capture.node.endPosition.row = nextHeaderStartRow - 1
      })
    } else {
      headerPair.forEach((capture) => {
        capture.node.endPosition.row = lines.length - 1
      })
    }
  }

  // Cast to QueryCapture[] — our MockCapture objects provide all properties
  // that the consuming code uses (node.startPosition, node.endPosition, node.text, node.parent, name)
  return headerCaptures.flat() as QueryCapture[]
}

export function formatMarkdownCaptures(captures: QueryCapture[], minSectionLines: number = 4): string | null {
  if (captures.length === 0) {
    return null
  }

  let formattedOutput = ""

  for (let i = 1; i < captures.length; i += 2) {
    const capture = captures[i]
    const startLine = capture.node.startPosition.row
    const endLine = capture.node.endPosition.row

    const sectionLength = endLine - startLine + 1
    if (sectionLength >= minSectionLines) {
      let headerLevel = 1

      const headerMatch = capture.name.match(/\.h(\d)$/)
      if (headerMatch && headerMatch[1]) {
        headerLevel = parseInt(headerMatch[1])
      }

      const headerPrefix = "#".repeat(headerLevel)

      formattedOutput += `${startLine}--${endLine} | ${headerPrefix} ${capture.node.text}\n`
    }
  }

  return formattedOutput.length > 0 ? formattedOutput : null
}
