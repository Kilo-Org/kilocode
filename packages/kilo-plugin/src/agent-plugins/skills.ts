export * as Skills from "./skills"

import { readFile, readdir, realpath } from "node:fs/promises"
import path from "node:path"
import { Diagnostic } from "./diagnostic"
import { isRecord } from "./manifest"
import { Paths } from "./paths"

/** A skill that conforms to the Agent Skills specification (https://agentskills.io/specification). */
export interface Info {
  readonly name: string
  readonly description: string
  /** The resolved `SKILL.md`; the skill's resources (`scripts/`, `references/`, `assets/`) sit beside it. */
  readonly path: string
  /** The Markdown body after the frontmatter. */
  readonly body: string
  readonly license?: string
  readonly compatibility?: string
  readonly metadata?: Readonly<Record<string, string>>
  readonly allowedTools?: string
}

export interface Result {
  readonly skills: readonly Info[]
  readonly diagnostics: readonly Diagnostic.Info[]
}

const scope = { component: "skills" } as const

/**
 * Discovers the skills of a plugin from its fixed `skills/` location (spec §6, §7.1): each immediate child directory
 * holding a regular file named exactly `SKILL.md`. Deeper descendants are never searched. `root` must be resolved.
 */
export async function discover(root: string): Promise<Result> {
  const location = path.join(root, "skills")
  const found = await Paths.kind(location)
  if (found === "missing") return { skills: [], diagnostics: [] }
  if (found !== "directory")
    return { skills: [], diagnostics: [Diagnostic.error("skills-invalid", '"skills" is not a directory', scope)] }
  // Each resolve can still fail if the plugin changes while it loads; that makes the item invalid, never a throw.
  const directory = await realpath(location).catch(() => undefined)
  if (!directory)
    return { skills: [], diagnostics: [Diagnostic.error("skills-invalid", '"skills" could not be resolved', scope)] }
  if (!Paths.contains(root, directory))
    return {
      skills: [],
      diagnostics: [Diagnostic.error("skills-invalid", '"skills" resolves outside the plugin root', scope)],
    }
  const children = await readdir(directory).catch(() => [])
  const results = await Promise.all(children.toSorted().map((child) => load(root, directory, child)))
  return {
    skills: results.flatMap((result) => (result && "skill" in result ? [result.skill] : [])),
    diagnostics: results.flatMap((result) => (result && "diagnostic" in result ? [result.diagnostic] : [])),
  }
}

async function load(
  root: string,
  directory: string,
  child: string,
): Promise<{ skill: Info } | { diagnostic: Diagnostic.Info } | undefined> {
  const folder = path.join(directory, child)
  if ((await Paths.kind(folder)) !== "directory") return
  // Compare names exactly: a case-insensitive filesystem would otherwise accept `skill.md`.
  const entries = await readdir(folder).catch(() => [] as string[])
  if (!entries.includes("SKILL.md")) return
  const file = path.join(folder, "SKILL.md")
  if ((await Paths.kind(file)) !== "file") return
  const item = { ...scope, item: child }
  const resolved = await realpath(file).catch(() => undefined)
  if (!resolved)
    return { diagnostic: Diagnostic.error("skill-invalid", `Skill "${child}" could not be resolved`, item) }
  if (!Paths.contains(root, resolved))
    return {
      diagnostic: Diagnostic.error("skill-outside-root", `Skill "${child}" resolves outside the plugin root`, item),
    }
  const content = await readFile(resolved, "utf8").catch(() => undefined)
  if (content === undefined)
    return { diagnostic: Diagnostic.error("skill-invalid", `Skill "${child}" could not be read`, item) }
  const parsed = parse(child, content)
  if (typeof parsed === "string")
    return { diagnostic: Diagnostic.error("skill-invalid", `Skipped skill "${child}": ${parsed}`, item) }
  return { skill: { ...parsed, path: resolved } }
}

/** Validates a `SKILL.md` against the Agent Skills specification. Returns the reason when it does not conform. */
export function parse(directory: string, content: string): Omit<Info, "path"> | string {
  const split = frontmatter(content)
  if (!split) return "SKILL.md must start with YAML frontmatter between --- lines"
  const data = yaml(split.yaml)
  if (data === undefined) return "the frontmatter is not valid YAML"
  if (!isRecord(data)) return "the frontmatter must be a YAML mapping"
  const name = data.name
  if (typeof name !== "string" || !validName(name))
    return typeof name === "string"
      ? `invalid name "${name}": use 1-64 lowercase letters, digits and single hyphens, not starting or ending with a hyphen`
      : 'frontmatter requires a string "name"'
  if (name !== directory) return `name "${name}" must match its directory name "${directory}"`
  const description = data.description
  if (typeof description !== "string" || description.length === 0 || description.length > 1024)
    return 'frontmatter requires a "description" of 1-1024 characters'
  if (data.license !== undefined && typeof data.license !== "string") return '"license" must be a string'
  if (
    data.compatibility !== undefined &&
    (typeof data.compatibility !== "string" || data.compatibility.length === 0 || data.compatibility.length > 500)
  )
    return '"compatibility" must be a string of 1-500 characters'
  if (
    data.metadata !== undefined &&
    !(isRecord(data.metadata) && Object.values(data.metadata).every((value) => typeof value === "string"))
  )
    return '"metadata" must map string keys to string values'
  if (data["allowed-tools"] !== undefined && typeof data["allowed-tools"] !== "string")
    return '"allowed-tools" must be a space-separated string'
  return {
    name,
    description,
    body: split.body,
    ...(typeof data.license === "string" ? { license: data.license } : {}),
    ...(typeof data.compatibility === "string" ? { compatibility: data.compatibility } : {}),
    ...(isRecord(data.metadata) ? { metadata: data.metadata as Record<string, string> } : {}),
    ...(typeof data["allowed-tools"] === "string" ? { allowedTools: data["allowed-tools"] } : {}),
  }
}

/** Agent Skills names: lowercase letters and digits in hyphen-separated runs, at most 64 characters. */
export function validName(name: string) {
  return (
    name.length >= 1 &&
    name.length <= 64 &&
    name === name.toLowerCase() &&
    /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(name)
  )
}

function frontmatter(content: string) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/)
  if (lines[0]?.trimEnd() !== "---") return
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---")
  if (end === -1) return
  return {
    yaml: lines.slice(1, end).join("\n"),
    body: lines
      .slice(end + 1)
      .join("\n")
      .replace(/^\n+/, ""),
  }
}

function yaml(text: string): unknown {
  if (text.trim() === "") return {}
  try {
    return Bun.YAML.parse(text) ?? {}
  } catch {
    return undefined
  }
}
