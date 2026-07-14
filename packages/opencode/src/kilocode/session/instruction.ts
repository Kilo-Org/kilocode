import path from "path"
import { Glob } from "@opencode-ai/core/util/glob"
import { ConfigMarkdown } from "@/config/markdown"
import { KilocodeMarkdown } from "../config/markdown"

export namespace KilocodeInstruction {
  const conventional = new Set(["AGENTS.md", "CLAUDE.md", "CONTEXT.md"])
  type Parsed = { content: string; paths?: string[] }

  export function content(text: string, item: string, options: KilocodeMarkdown.Options) {
    return KilocodeMarkdown.substitute(text, item, options)
  }

  export async function read(item: string, options: KilocodeMarkdown.Options) {
    return content(await KilocodeMarkdown.read(item, options), item, options)
  }

  export function rule(item: string) {
    return path.extname(item).toLowerCase() === ".md" && !conventional.has(path.basename(item))
  }

  export async function parse(item: string, options: KilocodeMarkdown.Options): Promise<Parsed> {
    try {
      const md = await ConfigMarkdown.parse(item, options)
      if (!Object.prototype.hasOwnProperty.call(md.data, "paths")) {
        return { content: await read(item, options) }
      }

      const value = md.data.paths
      const paths =
        typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((x) => typeof x === "string") : []
      return { content: md.content, paths }
    } catch {
      return { content: await read(item, options) }
    }
  }

  export function match(paths: string[], item: string, root: string) {
    if (!inside(item, root)) return false
    const rel = path.relative(root, item)
    const target = rel.replaceAll(path.sep, "/")
    return paths.some((pattern) => Glob.match(pattern, target))
  }

  const scan = (pattern: string, cwd: string) =>
    Glob.scan(pattern, { cwd, absolute: true, include: "file", dot: true, symlink: true })
      .then((items) => items.sort())
      .catch(() => [])

  const inside = (item: string, root: string) => {
    const rel = path.relative(root, item)
    return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
  }

  export async function claude(input: { home: string; directory: string; worktree: string; project: boolean }) {
    const global = await scan("rules/**/*.md", path.join(input.home, ".claude"))
    if (!input.project) return { global, project: [] }

    const project: string[] = []
    const stop = path.resolve(input.worktree === "/" ? input.directory : input.worktree)
    let current = path.resolve(input.directory)
    while (inside(current, stop)) {
      project.push(...(await scan(".claude/rules/**/*.md", current)))
      if (current === stop) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    return { global, project }
  }
}
