import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { execFile } from "child_process"
import { promisify } from "util"
import type {
  MarketplaceItem,
  SkillMarketplaceItem,
  InstallMarketplaceItemOptions,
  InstallResult,
  RemoveResult,
} from "./types"
import { MarketplacePaths } from "./paths"

const exec = promisify(execFile)

export class MarketplaceInstaller {
  constructor(private paths: MarketplacePaths) {}

  async install(
    item: MarketplaceItem,
    options: InstallMarketplaceItemOptions,
    workspace?: string,
  ): Promise<InstallResult> {
    const scope = options.target ?? "project"
    if (item.type === "skill") return this.installSkill(item, scope, workspace)
    return { success: false, slug: item.id, error: `${item.type} installation not yet implemented` }
  }

  async installSkill(
    item: SkillMarketplaceItem,
    scope: "project" | "global",
    workspace?: string,
  ): Promise<InstallResult> {
    if (!item.content) {
      return { success: false, slug: item.id, error: "Skill has no tarball URL" }
    }

    if (!isSafeId(item.id)) {
      return { success: false, slug: item.id, error: "Invalid skill id" }
    }

    const base = this.paths.skillsDir(scope, workspace)
    const dir = path.join(base, item.id)
    if (!path.resolve(dir).startsWith(path.resolve(base))) {
      return { success: false, slug: item.id, error: "Invalid skill id" }
    }

    try {
      await fs.access(dir)
      return { success: false, slug: item.id, error: "Skill already installed. Uninstall it before installing again." }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    }

    const stamp = Date.now()
    const tarball = path.join(os.tmpdir(), `kilo-skill-${item.id}-${stamp}.tar.gz`)
    // Stage under `base` (not os.tmpdir()) so fs.rename() never crosses filesystems (EXDEV).
    await fs.mkdir(base, { recursive: true })
    const staging = path.join(base, `.staging-${item.id}-${stamp}`)

    try {
      const response = await fetch(item.content)
      if (!response.ok) {
        return { success: false, slug: item.id, error: `Download failed: ${response.status}` }
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      await fs.writeFile(tarball, buffer)

      await fs.mkdir(staging, { recursive: true })
      await exec("tar", ["-xzf", tarball, "--strip-components=1", "-C", staging])

      const escaped = await findEscapedPaths(staging)
      if (escaped.length > 0) {
        console.warn(`Skill archive ${item.id} contains escaped paths:`, escaped)
        await fs.rm(staging, { recursive: true })
        return { success: false, slug: item.id, error: "Skill archive contains unsafe paths" }
      }

      try {
        await fs.access(path.join(staging, "SKILL.md"))
      } catch {
        console.warn(`Extracted skill ${item.id} missing SKILL.md, rolling back`)
        await fs.rm(staging, { recursive: true })
        return { success: false, slug: item.id, error: "Extracted archive missing SKILL.md" }
      }

      await fs.rename(staging, dir)

      return { success: true, slug: item.id, filePath: path.join(dir, "SKILL.md"), line: 1 }
    } catch (err) {
      console.warn(`Failed to install skill ${item.id}:`, err)
      try {
        await fs.rm(staging, { recursive: true })
      } catch {
        console.warn(`Failed to clean up staging directory ${staging}`)
      }
      return { success: false, slug: item.id, error: String(err) }
    } finally {
      try {
        await fs.unlink(tarball)
      } catch {
        console.warn(`Failed to clean up temp file ${tarball}`)
      }
    }
  }

  async remove(item: MarketplaceItem, scope: "project" | "global", workspace?: string): Promise<RemoveResult> {
    if (item.type === "skill") return this.removeSkill(item, scope, workspace)
    return { success: false, slug: item.id, error: `${item.type} removal not yet implemented` }
  }

  async removeSkill(
    item: SkillMarketplaceItem,
    scope: "project" | "global",
    workspace?: string,
  ): Promise<RemoveResult> {
    if (!isSafeId(item.id)) {
      return { success: false, slug: item.id, error: "Invalid skill id" }
    }
    const base = this.paths.skillsDir(scope, workspace)
    const dir = path.join(base, item.id)
    if (!path.resolve(dir).startsWith(path.resolve(base))) {
      return { success: false, slug: item.id, error: "Invalid skill id" }
    }
    try {
      await fs.access(dir)
      await fs.rm(dir, { recursive: true })
      return { success: true, slug: item.id }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { success: true, slug: item.id }
      }
      console.warn(`Failed to remove skill ${item.id}:`, err)
      return { success: false, slug: item.id, error: String(err) }
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function isSafeId(id: string): boolean {
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) return false
  return /^[\w\-@.]+$/.test(id)
}

async function findEscapedPaths(dir: string): Promise<string[]> {
  const resolved = path.resolve(dir)
  const escaped: string[] = []

  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.resolve(current, entry.name)
      if (!full.startsWith(resolved + path.sep) && full !== resolved) {
        escaped.push(full)
        continue
      }
      if (entry.isSymbolicLink()) {
        const target = await fs.realpath(full)
        if (!target.startsWith(resolved + path.sep) && target !== resolved) {
          escaped.push(full)
          continue
        }
      }
      if (entry.isDirectory()) {
        await walk(full)
      }
    }
  }

  await walk(dir)
  return escaped
}
