import path from "path"
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

  const paths = (data: Record<string, unknown>) => {
    if (!Object.prototype.hasOwnProperty.call(data, "paths")) return undefined
    const value = data.paths
    if (typeof value === "string") return [value]
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === "string")
  }

  export async function parse(text: string, item: string): Promise<Rule> {
    try {
      const md = await ConfigMarkdown.parseText(text, item)
      return {
        content: md.content,
        paths: paths(md.data),
      }
    } catch {
      return { content: await KilocodeMarkdown.substitute(text, item) }
    }
  }

  export function match(rule: Rule, filepath: string, root: string) {
    if (!rule.paths) return false
    if (!inside(filepath, root)) return false
    const rel = path.relative(root, filepath).replaceAll(path.sep, "/")
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
