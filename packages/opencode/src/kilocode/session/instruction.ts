import path from "path"
import { Glob } from "@opencode-ai/core/util/glob"
import { ConfigMarkdown } from "@/config/markdown"

export namespace KilocodeInstruction {
  export interface CompatibilityInput {
    home: string
    directory: string
    worktree: string
    enabled: boolean
    project: boolean
  }

  const scopes = (data: Record<string, unknown>) => {
    if (!Object.prototype.hasOwnProperty.call(data, "paths")) return undefined
    const value = data.paths
    if (typeof value === "string") return [value]
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === "string")
  }

  export async function parse(item: string) {
    try {
      const md = await ConfigMarkdown.parse(item)
      return {
        content: md.content,
        paths: scopes(md.data),
      }
    } catch {
      return { content: "" }
    }
  }

  export function match(parsed: { paths?: string[] }, filepath: string, root: string) {
    if (!parsed.paths) return false
    if (!inside(filepath, root)) return false
    const rel = path.relative(root, filepath).replaceAll(path.sep, "/")
    return parsed.paths.some((pattern) => Glob.match(pattern, rel))
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

  export async function compatibility(input: CompatibilityInput) {
    const result = new Set<string>()
    if (!input.enabled) return []

    for (const item of await scan("rules/**/*.md", path.join(input.home, ".claude"))) result.add(path.resolve(item))
    if (!input.project) return Array.from(result)

    for (const root of roots(input.directory, input.worktree)) {
      for (const item of await scan(".claude/rules/**/*.md", root)) result.add(path.resolve(item))
    }

    return Array.from(result)
  }
}
