import matter from "gray-matter"
import { Filesystem } from "@/util/filesystem"
import { FrontmatterError } from "@opencode-ai/core/v1/config/error"
import * as Log from "@opencode-ai/core/util/log" // kilocode_change
import { KilocodeMarkdown } from "../kilocode/config/markdown" // kilocode_change

const log = Log.create({ service: "config-markdown" }) // kilocode_change

export const FILE_REGEX = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g
export const SHELL_REGEX = /!`([^`]+)`/g

export function files(template: string) {
  return Array.from(template.matchAll(FILE_REGEX))
}

export function shell(template: string) {
  return Array.from(template.matchAll(SHELL_REGEX))
}

// other coding agents like claude code allow invalid yaml in their
// frontmatter, we need to fallback to a more permissive parser for those cases
export function fallbackSanitization(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return content

  const frontmatter = match[1]
  const lines = frontmatter.split(/\r?\n/)
  const result: string[] = []

  for (const line of lines) {
    // skip comments and empty lines
    if (line.trim().startsWith("#") || line.trim() === "") {
      result.push(line)
      continue
    }

    // skip lines that are continuations (indented)
    if (line.match(/^\s+/)) {
      result.push(line)
      continue
    }

    // match key: value pattern
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/)
    if (!kvMatch) {
      result.push(line)
      continue
    }

    const key = kvMatch[1]
    const value = kvMatch[2].trim()

    // skip if value is empty, already quoted, or uses block scalar
    if (value === "" || value === ">" || value === "|" || value.startsWith('"') || value.startsWith("'")) {
      result.push(line)
      continue
    }

    if (value.includes(":")) {
      // kilocode_change start - preserve unquoted colon values as exact strings
      result.push(`${key}: "${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
      // kilocode_change end
      continue
    }

    result.push(line)
  }

  const processed = result.join("\n")
  return content.replace(frontmatter, () => processed)
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function yamlMark(err: unknown): { line: number; column: number } | undefined {
  if (!err || typeof err !== "object") return undefined
  const raw = (err as Record<string, unknown>).mark
  if (!raw || typeof raw !== "object") return undefined
  const m = raw as Record<string, unknown>
  if (typeof m.line !== "number" || typeof m.column !== "number") return undefined
  return { line: m.line, column: m.column }
}

// kilocode_change start - extract a usable editor position from a YAML parse error
function frontmatterErrorPosition(text: string, err: unknown): { line?: number; column?: number } {
  const mark = yamlMark(err)
  if (!mark) return {}

  const match = text.match(FRONTMATTER)
  if (!match) return { line: mark.line, column: mark.column }

  const startLine = text.slice(0, match.index).split(/\r?\n/).length - 1
  const lines = match[1].split(/\r?\n/)
  const end = Math.min(mark.line, lines.length - 1)
  for (const [i, line] of lines.entries()) {
    if (i > end) break
    if (!line) continue
    // Point at keys where the colon is immediately followed by a value,
    // which is the common "missing space after colon" mistake.
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\S/)
    if (kv) return { line: startLine + 1 + i, column: kv[1].length }
  }

  return { line: startLine + 1 + mark.line, column: mark.column }
}
// kilocode_change end

// kilocode_change start - accept source trust and confine untrusted markdown source reads
export async function parse(filePath: string, options: KilocodeMarkdown.Options) {
  const template = options.trusted
    ? await Filesystem.readText(filePath)
    : await KilocodeMarkdown.read(filePath, options)
  // kilocode_change end

  // kilocode_change start - substitute content and retry invalid frontmatter with permissive sanitization
  let firstError: unknown

  try {
    const md = matter(template, {})
    md.content = await KilocodeMarkdown.substitute(md.content, filePath, options) // kilocode_change
    return md
  } catch (err) {
    firstError = err
  }

  try {
    const md = matter(fallbackSanitization(template), {})
    md.content = await KilocodeMarkdown.substitute(md.content, filePath, options) // kilocode_change
    return md
  } catch (fallbackErr) {
    log.debug("fallback frontmatter parse failed", { path: filePath, err: fallbackErr })
  }

  const pos = frontmatterErrorPosition(template, firstError)
  const detail = firstError instanceof Error
    ? firstError.message
    : typeof firstError === "string"
      ? firstError
      : "unknown error"
  throw new FrontmatterError(
    {
      path: filePath,
      message: `${filePath}: Failed to parse YAML frontmatter: ${detail}`,
      line: pos.line,
      column: pos.column,
    },
    { cause: firstError },
  )
  // kilocode_change end
}

// kilocode_change start - export helpers as namespace object
export const ConfigMarkdown = {
  FILE_REGEX,
  SHELL_REGEX,
  files,
  shell,
  fallbackSanitization,
  parse,
}
// kilocode_change end
