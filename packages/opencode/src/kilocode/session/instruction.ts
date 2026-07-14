import path from "path"
import { readdir, realpath, stat } from "node:fs/promises"
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

  const inside = (item: string, root: string) => {
    const rel = path.relative(root, item)
    return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
  }

  const scan = async (root: string, bound?: string) => {
    const found: string[] = []
    const seen = new Set<string>()
    const visit = async (dir: string): Promise<void> => {
      const target = await realpath(dir).catch(() => undefined)
      if (!target || (bound && !inside(target, bound)) || seen.has(target)) return
      seen.add(target)

      const entries = await readdir(target, { withFileTypes: true }).catch(() => [])
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const item = path.join(dir, entry.name)
        const source = path.join(target, entry.name)
        if (entry.isDirectory()) {
          await visit(item)
          continue
        }
        if (entry.isSymbolicLink()) {
          const info = await stat(source).catch(() => undefined)
          if (info?.isDirectory()) {
            await visit(item)
            continue
          }
          if (!info?.isFile()) continue
          const resolved = await realpath(item).catch(() => undefined)
          if (!resolved || (bound && !inside(resolved, bound))) continue
        } else if (!entry.isFile()) {
          continue
        }
        if (path.extname(item).toLowerCase() === ".md") found.push(item)
      }
    }
    await visit(root)
    return found.sort()
  }

  export async function claude(input: { home: string; directory: string; worktree: string; project: boolean }) {
    const global = await scan(path.join(input.home, ".claude", "rules"))
    if (!input.project) return { global, project: [] }

    const project: string[] = []
    const stop = path.resolve(input.worktree === "/" ? input.directory : input.worktree)
    let current = path.resolve(input.directory)
    while (inside(current, stop)) {
      project.push(...(await scan(path.join(current, ".claude", "rules"), stop)))
      if (current === stop) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    return { global, project }
  }
}
