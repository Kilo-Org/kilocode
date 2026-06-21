// kilocode_change - new file
// Install and remove marketplace skills on disk. Ports the VS Code
// MarketplaceInstaller.installSkill/removeSkill flow into the CLI/TUI.
// Skills are extracted into ~/.kilo/skills/<id>/ (global) or
// <workspace>/.kilo/skills/<id>/ (project) and discovered by glob on the
// next session start. The caller (server handler) disposes the instance
// so skill state reloads.

import * as fs from "fs/promises"
import * as path from "path"
import { randomUUID } from "crypto"
import { Process } from "@/util/process"
import { Global } from "@opencode-ai/core/global"
import { findEscapedPaths, resolveTarget, skillsDir, type Scope } from "./install-target"

export interface InstallInput {
  id: string
  url: string // tarball content URL
  scope: Scope
  workspace?: string
}

export interface RemoveInput {
  id: string
  scope: Scope
  workspace?: string
}

export interface Result {
  success: boolean
  slug: string
  error?: string
  filePath?: string
}

async function exists(filepath: string): Promise<boolean> {
  try {
    await fs.access(filepath)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
    throw err
  }
}

/**
 * Download a skill tarball from `url`, extract it with `--strip-components=1`,
 * validate the archive is safe and contains a SKILL.md, then atomically
 * rename the staging directory into place.
 */
export async function install(input: InstallInput): Promise<Result> {
  const { id, url, scope, workspace } = input

  if (scope === "project" && !workspace) {
    return { success: false, slug: id, error: "No workspace directory for project-scope install" }
  }
  if (!url) return { success: false, slug: id, error: "Skill has no tarball URL" }

  const base = skillsDir(scope, workspace)
  let dir: string
  try {
    dir = resolveTarget(base, id)
  } catch (err) {
    return { success: false, slug: id, error: err instanceof Error ? err.message : "Invalid skill id" }
  }

  if (await exists(dir)) {
    return { success: false, slug: id, error: "Skill already installed. Uninstall it before installing again." }
  }

  // Stage under base so fs.rename never crosses filesystems (EXDEV).
  await fs.mkdir(base, { recursive: true })
  const staging = await fs.mkdtemp(path.join(base, `.staging-${id}-`))
  const tarball = path.join(Global.Path.tmp, `kilo-skill-${id}-${randomUUID()}.tar.gz`)

  try {
    const response = await fetch(url)
    if (!response.ok) return { success: false, slug: id, error: `Download failed: ${response.status}` }

    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(tarball, buffer)

    await Process.run(["tar", "-xzf", tarball, "--strip-components=1", "-C", staging])

    const escaped = await findEscapedPaths(staging)
    if (escaped.length > 0) {
      console.warn(`Skill archive ${id} contains escaped paths:`, escaped)
      return { success: false, slug: id, error: "Skill archive contains unsafe paths" }
    }

    try {
      await fs.access(path.join(staging, "SKILL.md"))
    } catch {
      return { success: false, slug: id, error: "Extracted archive missing SKILL.md" }
    }

    await fs.rename(staging, dir)
    return { success: true, slug: id, filePath: path.join(dir, "SKILL.md") }
  } catch (err) {
    if (await exists(dir)) {
      return { success: false, slug: id, error: "Skill already installed. Uninstall it before installing again." }
    }
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`Failed to install skill ${id}:`, err)
    return { success: false, slug: id, error: message }
  } finally {
    await Promise.all([
      fs.rm(staging, { recursive: true, force: true }).catch((err) => {
        console.warn(`Failed to clean up staging directory ${staging}:`, err)
      }),
      fs.rm(tarball, { force: true }).catch((err) => {
        console.warn(`Failed to clean up temp file ${tarball}:`, err)
      }),
    ])
  }
}

/**
 * Remove an installed skill directory. Complements the manifest-only
 * KiloSkill.remove (which only deletes SKILL.md) — this removes the whole
 * skill folder, which is what the marketplace installer created.
 */
export async function remove(input: RemoveInput): Promise<Result> {
  const { id, scope, workspace } = input

  if (scope === "project" && !workspace) {
    return { success: false, slug: id, error: "No workspace directory for project-scope removal" }
  }

  const base = skillsDir(scope, workspace)
  let dir: string
  try {
    dir = resolveTarget(base, id)
  } catch (err) {
    return { success: false, slug: id, error: err instanceof Error ? err.message : "Invalid skill id" }
  }

  try {
    await fs.access(dir)
    await fs.rm(dir, { recursive: true })
    return { success: true, slug: id }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { success: true, slug: id }
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`Failed to remove skill ${id}:`, err)
    return { success: false, slug: id, error: message }
  }
}

export * as Install from "./install"
