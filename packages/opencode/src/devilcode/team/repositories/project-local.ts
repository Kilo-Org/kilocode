import { promises as fs } from "fs"
import path from "path"
import { CanonicalTeamConfig } from "../config"
import type { TeamRepository, TeamHandle } from "../repository"
import { migrateTeamConfig } from "../versioning"

export interface CreateProjectLocalTeamRepositoryOptions {
  cwd?: string
}

const RESERVED_ID = "project"

export function createProjectLocalTeamRepository(
  options: CreateProjectLocalTeamRepositoryOptions = {},
): TeamRepository {
  const cwd = options.cwd ?? process.cwd()
  const filePath = path.join(cwd, ".planning", "team.json")

  function assertId(id: string): void {
    if (id !== RESERVED_ID) {
      throw new Error(`project-local repo only supports id="${RESERVED_ID}", got "${id}"`)
    }
  }

  return {
    async listTeams(): Promise<TeamHandle[]> {
      let text: string
      let stat: Awaited<ReturnType<typeof fs.stat>>
      try {
        stat = await fs.stat(filePath)
        text = await fs.readFile(filePath, "utf-8")
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException
        if (e?.code === "ENOENT") return []
        throw err
      }
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(text) as Record<string, unknown>
      } catch {
        parsed = {}
      }
      const name = typeof parsed.name === "string" ? (parsed.name as string) : "Project Team"
      return [
        {
          id: RESERVED_ID,
          name,
          path: filePath,
          updatedAt: stat.mtime.toISOString(),
        },
      ]
    },

    async loadTeam(id: string): Promise<CanonicalTeamConfig> {
      assertId(id)
      let text: string
      try {
        text = await fs.readFile(filePath, "utf-8")
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException
        if (e?.code === "ENOENT") {
          throw new Error(`Team "${RESERVED_ID}" not found`)
        }
        throw err
      }
      const raw = JSON.parse(text)
      return await migrateTeamConfig(raw)
    },

    async saveTeam(id: string, config: CanonicalTeamConfig): Promise<TeamHandle> {
      assertId(id)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      const validated = CanonicalTeamConfig.parse(config)
      await fs.writeFile(filePath, JSON.stringify(validated, null, 2) + "\n", "utf-8")
      const stat = await fs.stat(filePath)
      const maybeName = (config as unknown as Record<string, unknown>).name
      const name = typeof maybeName === "string" ? (maybeName as string) : "Project Team"
      return {
        id: RESERVED_ID,
        name,
        path: filePath,
        updatedAt: stat.mtime.toISOString(),
      }
    },

    async deleteTeam(id: string): Promise<void> {
      assertId(id)
      try {
        await fs.unlink(filePath)
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException
        if (e?.code === "ENOENT") return
        throw err
      }
    },
  }
}
