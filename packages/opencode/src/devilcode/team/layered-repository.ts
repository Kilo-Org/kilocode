import type { TeamRepository, TeamHandle } from "./repository"
import { TeamNotFoundError } from "./repository"
import type { CanonicalTeamConfig } from "./config"

interface LayerConfig {
  name: string
  repository: TeamRepository
  writable?: boolean
}

interface LayeredTeamRepositoryOptions {
  layers: LayerConfig[]
  defaultWriteLayer?: string
}

export type LayeredTeamRepository = TeamRepository & {
  saveTeamToLayer(layerName: string, id: string, config: CanonicalTeamConfig): Promise<TeamHandle>
}

function isNotFound(err: unknown): boolean {
  if (!err) return false
  if (err instanceof TeamNotFoundError) return true
  const e = err as { code?: unknown; message?: unknown }
  if (e.code === "ENOENT") return true
  if (typeof e.message === "string" && /not found/i.test(e.message)) return true
  return false
}

export function createLayeredTeamRepository(options: LayeredTeamRepositoryOptions): LayeredTeamRepository {
  const { layers, defaultWriteLayer } = options

  function findWriteLayer(): LayerConfig {
    if (defaultWriteLayer) {
      const named = layers.find((l) => l.name === defaultWriteLayer)
      if (!named) throw new Error(`Default write layer "${defaultWriteLayer}" not found`)
      if (named.writable === false) {
        throw new Error(`Default write layer "${defaultWriteLayer}" is not writable`)
      }
      return named
    }
    const writable = layers.find((l) => l.writable !== false)
    if (!writable) throw new Error("No writable layer available")
    return writable
  }

  return {
    async listTeams(): Promise<TeamHandle[]> {
      const seen = new Set<string>()
      const out: TeamHandle[] = []
      for (const layer of layers) {
        const handles = await layer.repository.listTeams()
        for (const handle of handles) {
          if (seen.has(handle.id)) continue
          seen.add(handle.id)
          out.push(handle)
        }
      }
      return out
    },

    async loadTeam(id: string): Promise<CanonicalTeamConfig> {
      for (const layer of layers) {
        try {
          return await layer.repository.loadTeam(id)
        } catch (err) {
          if (isNotFound(err)) continue
          throw err
        }
      }
      throw new Error(`Team "${id}" not found in any layer`)
    },

    async saveTeam(id: string, config: CanonicalTeamConfig): Promise<TeamHandle> {
      const target = findWriteLayer()
      return await target.repository.saveTeam(id, config)
    },

    async saveTeamToLayer(layerName: string, id: string, config: CanonicalTeamConfig): Promise<TeamHandle> {
      const layer = layers.find((l) => l.name === layerName)
      if (!layer) throw new Error(`Layer "${layerName}" not found`)
      if (layer.writable === false) throw new Error(`Layer "${layerName}" is not writable`)
      return await layer.repository.saveTeam(id, config)
    },

    async deleteTeam(id: string): Promise<void> {
      for (const layer of layers) {
        if (layer.writable === false) continue
        try {
          await layer.repository.deleteTeam(id)
        } catch (err) {
          if (isNotFound(err)) continue
          throw err
        }
      }
    },
  }
}
