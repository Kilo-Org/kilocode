import path from "path"
import matter from "gray-matter"
import { Glob } from "@opencode-ai/core/util/glob"
import { ConfigMarkdown } from "@/config/markdown"
import { KilocodeMarkdown } from "../config/markdown"

export namespace KilocodeInstructionRules {
  export interface Rule {
    content: string
    paths?: string[]
  }

  export interface ClaudeRulesInput {
    home: string
    directory: string
    worktree: string
    disabled: boolean
    project: boolean
  }

  const frontmatter = (text: string) => /^---\r?\n[\s\S]*?\r?\n---/.test(text)

  const values = (value: unknown) => {
    if (typeof value === "string") return [value]
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === "string")
  }

  const paths = (data: Record<string, unknown>) => {
    if (!Object.prototype.hasOwnProperty.call(data, "paths")) return undefined
    return values(data.paths)
  }

  async function body(text: string, item: string) {
    const parsed = matter(text)
    return {
      content: await KilocodeMarkdown.substitute(parsed.content, item),
      paths: paths(parsed.data),
    }
  }

  export async function parse(text: string, item: string): Promise<Rule> {
    if (!frontmatter(text)) return { content: await KilocodeMarkdown.substitute(text, item) }

    try {
      return await body(text, item)
    } catch {
      try {
        return await body(ConfigMarkdown.fallbackSanitization(text), item)
      } catch {
        return { content: await KilocodeMarkdown.substitute(text, item) }
      }
    }
  }

  export function match(rule: Rule, filepath: string, root: string) {
    if (!rule.paths) return false
    const rel = path.relative(root, filepath).replaceAll(path.sep, "/")
    if (rel.startsWith("..") || path.isAbsolute(rel)) return false
    return rule.paths.some((pattern) => Glob.match(pattern, rel))
  }

  function add(result: string[], seen: Set<string>, item: string) {
    const resolved = path.resolve(item)
    if (seen.has(resolved)) return
    seen.add(resolved)
    result.push(resolved)
  }

  async function scan(pattern: string, cwd: string) {
    return Glob.scan(pattern, { cwd, absolute: true, include: "file", dot: true }).catch(() => [])
  }

  function roots(directory: string, worktree: string) {
    const result: string[] = []
    const stop = path.resolve(worktree === "/" ? directory : worktree)
    let current = path.resolve(directory)

    while (inside(current, stop)) {
      result.push(current)
      if (current === stop) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }

    return result
  }

  function inside(item: string, root: string) {
    const rel = path.relative(root, item)
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
  }

  export async function claude(input: ClaudeRulesInput) {
    const result: string[] = []
    const seen = new Set<string>()
    if (input.disabled) return result

    for (const item of await scan("rules/**/*.md", path.join(input.home, ".claude"))) add(result, seen, item)
    if (!input.project) return result

    for (const root of roots(input.directory, input.worktree)) {
      for (const item of await scan(".claude/rules/**/*.md", root)) add(result, seen, item)
    }

    return result
  }
}
