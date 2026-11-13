import * as fs from "fs/promises"
import * as path from "path"
import type { LanguageParser } from "./languageParser"
import { loadRequiredLanguageParsers } from "./languageParser"
import { parseMarkdown } from "./markdownParser"
import type { QueryCapture } from "web-tree-sitter"
import { Log } from "../util/log"

const log = Log.create({ service: "tree-sitter" })

const METHOD_CAPTURE = ["definition.method", "definition.method.start"]

const DEFAULT_MIN_COMPONENT_LINES_VALUE = 4

let currentMinComponentLines = DEFAULT_MIN_COMPONENT_LINES_VALUE

export function getMinComponentLines(): number {
  return currentMinComponentLines
}

export function setMinComponentLines(value: number): void {
  currentMinComponentLines = value
}

function shouldSkipMinLines(lineCount: number, capture: QueryCapture, _language: string) {
  if (METHOD_CAPTURE.includes(capture.name)) {
    // In OOP languages, method signatures are only one line and should not be ignored
    return false
  }
  return lineCount < getMinComponentLines()
}

const extensions = [
  // Shell and build systems
  "bash",
  "bazel",
  "bzl",
  "build",
  "gradle",
  "ninja",
  "sh",
  "zsh",

  // Web and frontend
  "css",
  "ejs",
  "erb",
  "htm",
  "html",
  "js",
  "jsx",
  "ts",
  "tsx",
  "vue",

  // Native and systems languages
  "c",
  "cpp",
  "cs",
  "go",
  "h",
  "hpp",
  "m",
  "mm",
  "rs",
  "swift",
  "zig",

  // JVM and BEAM languages
  "ex",
  "exs",
  "java",
  "kt",
  "kts",
  "scala",

  // Scripting and application languages
  "dart",
  "el",
  "elm",
  "lua",
  "php",
  "py",
  "r",
  "rb",
  "vb",

  // Functional and specialized languages
  "ml",
  "mli",
  "ql",
  "rdl",
  "res",
  "resi",
  "sol",
  "tla",

  // Data and documentation
  "json",
  "markdown",
  "md",
  "rst",
  "sql",
  "toml",
  "yaml",
  "yml",
].map((e) => `.${e}`)

export { extensions }

export async function parseSourceCodeDefinitionsForFile(filePath: string): Promise<string | undefined> {
  try {
    await fs.access(path.resolve(filePath))
  } catch {
    return "This file does not exist or you do not have permission to access it."
  }

  const ext = path.extname(filePath).toLowerCase()
  if (!extensions.includes(ext)) {
    return undefined
  }

  // Markdown files use a custom parser (no tree-sitter WASM needed)
  if (ext === ".md" || ext === ".markdown") {
    const fileContent = await fs.readFile(filePath, "utf8")
    const lines = fileContent.split("\n")
    const markdownCaptures = parseMarkdown(fileContent)
    const markdownDefinitions = processCaptures(markdownCaptures, lines, "markdown")

    if (markdownDefinitions) {
      return `# ${path.basename(filePath)}\n${markdownDefinitions}`
    }
    return undefined
  }

  // For other file types, load parser and use tree-sitter
  try {
    const languageParsers = await loadRequiredLanguageParsers([filePath])

    const definitions = await parseFile(filePath, languageParsers)
    if (definitions) {
      return `# ${path.basename(filePath)}\n${definitions}`
    }

    return undefined
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const isUnsupported =
      msg.startsWith("Unsupported language:") || msg.startsWith("Missing tree-sitter language WASM:")

    if (!isUnsupported) {
      throw error
    }

    log.debug("skipping AST definition extraction for fallback-only extension", {
      filePath,
      ext,
      err: msg,
    })
    return undefined
  }
}

function processCaptures(captures: QueryCapture[], lines: string[], language: string): string | null {
  const needsHtmlFiltering = ["jsx", "tsx"].includes(language)

  const isNotHtmlElement = (line: string): boolean => {
    if (!needsHtmlFiltering) return true
    const HTML_ELEMENTS = /^[^A-Z]*<\/?(?:div|span|button|input|h[1-6]|p|a|img|ul|li|form)\b/
    const trimmedLine = line.trim()
    return !HTML_ELEMENTS.test(trimmedLine)
  }

  if (captures.length === 0) {
    return null
  }

  let formattedOutput = ""

  captures.sort((a, b) => a.node.startPosition.row - b.node.startPosition.row)

  const processedLines = new Set<string>()

  captures.forEach((capture) => {
    const { node, name } = capture

    if (!name.includes("definition") && !name.includes("name")) {
      return
    }

    const definitionNode = name.includes("name") ? node.parent : node
    if (!definitionNode) return

    const startLine = definitionNode.startPosition.row
    const endLine = definitionNode.endPosition.row
    const lineCount = endLine - startLine + 1

    if (shouldSkipMinLines(lineCount, capture, language)) {
      return
    }

    const lineKey = `${startLine}-${endLine}`

    if (processedLines.has(lineKey)) {
      return
    }

    const startLineContent = lines[startLine]?.trim() ?? ""

    if (name.includes("name.definition")) {
      const componentName = node.text

      if (!processedLines.has(lineKey) && componentName) {
        formattedOutput += `${startLine + 1}--${endLine + 1} | ${lines[startLine]}\n`
        processedLines.add(lineKey)
      }
    } else if (isNotHtmlElement(startLineContent)) {
      formattedOutput += `${startLine + 1}--${endLine + 1} | ${lines[startLine]}\n`
      processedLines.add(lineKey)

      if (node.parent && node.parent.lastChild) {
        const contextEnd = node.parent.lastChild.endPosition.row
        const contextSpan = contextEnd - node.parent.startPosition.row + 1

        if (contextSpan >= getMinComponentLines()) {
          const rangeKey = `${node.parent.startPosition.row}-${contextEnd}`
          if (!processedLines.has(rangeKey)) {
            formattedOutput += `${node.parent.startPosition.row + 1}--${contextEnd + 1} | ${lines[node.parent.startPosition.row]}\n`
            processedLines.add(rangeKey)
          }
        }
      }
    }
  })

  if (formattedOutput.length > 0) {
    return formattedOutput
  }

  return null
}

async function parseFile(filePath: string, languageParsers: LanguageParser): Promise<string | null> {
  const fileContent = await fs.readFile(filePath, "utf8")
  const extLang = path.extname(filePath).toLowerCase().slice(1)

  const { parser, query } = languageParsers[extLang] || {}
  if (!parser || !query) {
    return `Unsupported file type: ${filePath}`
  }

  try {
    const tree = parser.parse(fileContent)
    const captures = tree ? query.captures(tree.rootNode) : []
    const lines = fileContent.split("\n")
    return processCaptures(captures, lines, extLang)
  } catch (error) {
    log.error(`Error parsing file: ${filePath}`, {
      err: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
