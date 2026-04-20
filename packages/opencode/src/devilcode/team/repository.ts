/**
 * Team persistence seam.
 *
 * Phase 4 ships the FileSystem implementation that writes to ~/.local/share/kilo/teams/<id>.json.
 * Phase 6 will ship additional implementations (project-local override at .planning/team.json,
 * remote registry fetch). The TeamRepository interface is the contract that both layers honor.
 *
 * See .planning/specs/04-team-builder-views-spec.md
 */
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { CanonicalTeamConfig } from "./config"

export type TeamHandle = {
  id: string
  name: string
  path: string
  updatedAt: string
}

export interface TeamRepository {
  listTeams(): Promise<TeamHandle[]>
  loadTeam(id: string): Promise<CanonicalTeamConfig>
  saveTeam(id: string, config: CanonicalTeamConfig): Promise<TeamHandle>
  deleteTeam(id: string): Promise<void>
}

export type CreateFileSystemTeamRepositoryOptions = {
  rootDir?: string
}

export function createFileSystemTeamRepository(
  options: CreateFileSystemTeamRepositoryOptions = {},
): TeamRepository {
  const rootDir =
    options.rootDir ?? path.join(os.homedir(), ".local", "share", "kilo", "teams")

  async function ensureDir(): Promise<void> {
    await fs.mkdir(rootDir, { recursive: true })
  }

  function pathFor(id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid team id "${id}" — must match /^[a-zA-Z0-9_-]+$/`)
    }
    return path.join(rootDir, `${id}.json`)
  }

  return {
    async listTeams() {
      try {
        await ensureDir()
        const entries = await fs.readdir(rootDir, { withFileTypes: true })
        const handles: TeamHandle[] = []
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".json")) continue
          const id = entry.name.slice(0, -".json".length)
          const filePath = path.join(rootDir, entry.name)
          const stat = await fs.stat(filePath)
          let name = id
          try {
            const raw = JSON.parse(await fs.readFile(filePath, "utf-8"))
            if (typeof raw?.name === "string") name = raw.name
          } catch {
            // malformed — surface id only
          }
          handles.push({ id, name, path: filePath, updatedAt: stat.mtime.toISOString() })
        }
        return handles.sort((a, b) => a.id.localeCompare(b.id))
      } catch (err: any) {
        if (err?.code === "ENOENT") return []
        throw err
      }
    },

    async loadTeam(id) {
      const filePath = pathFor(id)
      let raw: unknown
      try {
        raw = JSON.parse(await fs.readFile(filePath, "utf-8"))
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(`Team "${id}" not found`)
        }
        throw err
      }
      return CanonicalTeamConfig.parse({ ...(raw as Record<string, unknown>), enabled: true })
    },

    async saveTeam(id, config) {
      await ensureDir()
      const filePath = pathFor(id)
      const validated = CanonicalTeamConfig.parse({ ...config, enabled: true })
      await fs.writeFile(filePath, JSON.stringify(validated, null, 2) + "\n", "utf-8")
      const stat = await fs.stat(filePath)
      return { id, name: (config as Record<string, unknown>).name as string ?? id, path: filePath, updatedAt: stat.mtime.toISOString() }
    },

    async deleteTeam(id) {
      const filePath = pathFor(id)
      await fs.unlink(filePath)
    },
  }
}
