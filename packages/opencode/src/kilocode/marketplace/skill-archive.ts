import { lstat, mkdtemp, readdir, realpath, rm } from "fs/promises"
import os from "os"
import path from "path"
import { parse as parseYaml } from "yaml"
import { isRecord } from "@/util/record"
import { Process } from "@/util/process"

export const OWNER = ".kilo-marketplace.json"

export async function findEscapedPaths(dir: string): Promise<string[]> {
  const root = path.resolve(dir)
  const escaped: string[] = []

  async function walk(current: string): Promise<void> {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const full = path.resolve(current, item.name)
      if (!full.startsWith(root + path.sep) && full !== root) {
        escaped.push(full)
        continue
      }
      if (item.isSymbolicLink()) {
        const target = await realpath(full)
        if (!target.startsWith(root + path.sep) && target !== root) {
          escaped.push(full)
          continue
        }
      }
      if (item.isDirectory()) await walk(full)
    }
  }

  await walk(dir)
  return escaped
}

export async function stageSkill(item: { id: string; content: string }, dir: string, strict = false) {
  const cache = await mkdtemp(path.join(os.tmpdir(), "kilo-skill-"))
  const archive = "skill.tar.gz"
  const file = path.join(cache, archive)
  // Do not inherit tar options that can change listing or extraction behavior.
  const opts = { cwd: cache, env: { TAR_OPTIONS: "", LC_ALL: "C", COPYFILE_DISABLE: "1" } }
  try {
    if (item.content.startsWith("data:")) {
      const data = item.content.match(/^data:[^,]*;base64,(.*)$/)
      if (!data) throw new Error("Unsupported skill archive data URL")
      await Bun.write(file, Buffer.from(data[1], "base64"))
    } else {
      const response = await fetch(item.content, { signal: AbortSignal.timeout(60_000) })
      if (!response.ok) throw new Error(`Download failed: ${response.status}`)
      await Bun.write(file, Buffer.from(await response.arrayBuffer()))
    }

    if (strict) {
      // Inspect before extraction. Post-extraction checks alone cannot undo a tar
      // traversal, hard link, or symlink that already wrote outside staging.
      const names = await Process.lines(["tar", "-tzPf", archive], opts)
      const entries = await Process.lines(["tar", "-tvzPf", archive], opts)
      const seen = new Set<string>()
      const roots = new Set<string>()
      if (!names.length || names.length !== entries.length) throw new Error("Invalid skill archive listing")
      for (const [index, name] of names.entries()) {
        const type = entries.at(index)?.at(0)
        const parts = name.replace(/\/$/, "").split("/")
        if (
          (type !== "-" && type !== "d") ||
          /[\\:\x00-\x1f\x7f]/.test(name) ||
          parts.some(
            (part) =>
              !part ||
              part === "." ||
              part === ".." ||
              /[. ]$/.test(part) ||
              /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part) ||
              part.toLowerCase() === OWNER,
          ) ||
          (parts.length === 1 && type !== "d")
        ) {
          throw new Error("Skill archive contains unsafe paths, links, or ownership metadata")
        }
        const key = parts.join("/").toLowerCase()
        if (seen.has(key)) throw new Error("Skill archive contains duplicate paths")
        seen.add(key)
        roots.add(parts.at(0)!)
      }
      if (roots.size !== 1) throw new Error("Skill archive must contain one top-level directory")
    }

    // Extract with the working directory set to the target. An absolute Windows
    // path passed to `-C` contains a drive-letter colon, which GNU tar misreads
    // as a remote host, so use a relative archive path and the working directory.
    const relative = path.relative(dir, file)
    const source = relative && !path.isAbsolute(relative) ? relative : file
    await Process.run(["tar", "-xzf", source, "--strip-components=1", "--no-same-owner", "--no-same-permissions"], {
      ...opts,
      cwd: dir,
    })
    if ((await findEscapedPaths(dir)).length) throw new Error("Skill archive contains unsafe paths")
    const owner = await lstat(path.join(dir, OWNER)).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return undefined
      throw err
    })
    if (owner) throw new Error("Skill archive contains ownership metadata")
    const skill = Bun.file(path.join(dir, "SKILL.md"))
    if (!(await skill.exists())) throw new Error("Extracted archive missing SKILL.md")
    if (!strict) return

    // Parse only plain YAML frontmatter. gray-matter selects a parser from the
    // opening delimiter and its JavaScript engine uses eval, so an archive with
    // `---javascript` would execute code during staging. Restricting the opening
    // delimiter to a bare `---` and parsing YAML directly removes that path.
    const text = await skill.text()
    const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
    if (!front) throw new Error(`Skill ${item.id}: SKILL.md must start with YAML frontmatter`)
    const data: unknown = (() => {
      try {
        return parseYaml(front[1])
      } catch (err) {
        throw new Error(
          `Skill ${item.id}: invalid YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    })()
    if (!isRecord(data)) throw new Error(`Skill ${item.id}: SKILL.md must start with YAML frontmatter`)
    if (data.name !== item.id) throw new Error(`Skill ${item.id}: SKILL.md name must match the companion id`)
    if (typeof data.description !== "string" || !data.description.trim()) {
      throw new Error(`Skill ${item.id}: SKILL.md must have a non-empty description`)
    }
  } finally {
    await rm(cache, { recursive: true, force: true }).catch((err) =>
      console.warn("Failed to clean marketplace tarball", err),
    )
  }
}
