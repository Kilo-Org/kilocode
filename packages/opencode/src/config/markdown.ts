import { NamedError } from "@opencode-ai/core/util/error"
import matter from "gray-matter"
import { z } from "zod"
import { Filesystem } from "@/util/filesystem"
import { KilocodeMarkdown } from "../kilocode/config/markdown" // kilocode_change

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

export async function parse(filePath: string) {
  const template = await Filesystem.readText(filePath)

  // kilocode_change start - substitute content and retry invalid frontmatter with permissive sanitization
  try {
    const md = matter(template)
    md.content = await KilocodeMarkdown.substitute(md.content, filePath) // kilocode_change
    return md
  } catch {
    try {
      const md = matter(fallbackSanitization(template))
      md.content = await KilocodeMarkdown.substitute(md.content, filePath) // kilocode_change
      return md
    } catch (err) {
      throw new FrontmatterError(
        {
          path: filePath,
          message: `${filePath}: Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
        },
        { cause: err },
      )
    }
  }
  // kilocode_change end
}

// kilocode_change start - export structured frontmatter parse errors
export const FrontmatterError = NamedError.create(
  "ConfigFrontmatterError",
  z.object({
    path: z.string(),
    message: z.string(),
  }),
)
// kilocode_change end

// kilocode_change start - export helpers as namespace object
export const ConfigMarkdown = {
  FILE_REGEX,
  SHELL_REGEX,
  files,
  shell,
  fallbackSanitization,
  parse,
  FrontmatterError,
}
// kilocode_change end
