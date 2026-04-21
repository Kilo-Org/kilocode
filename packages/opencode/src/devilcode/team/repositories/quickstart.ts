import type { CanonicalTeamConfig } from "../config"
import type { TeamRepository, TeamHandle } from "../repository"
import { loadQuickstartTemplates } from "../quickstarts"

export function createQuickstartTeamRepository(): TeamRepository {
  const BUNDLED_TIMESTAMP = "1970-01-01T00:00:00.000Z"

  return {
    async listTeams(): Promise<TeamHandle[]> {
      const templates = loadQuickstartTemplates()
      const handles: TeamHandle[] = []
      for (const [id, template] of Object.entries(templates)) {
        handles.push({
          id,
          name: template.name,
          path: `<bundled:${id}>`,
          updatedAt: BUNDLED_TIMESTAMP,
          isQuickstart: true,
        })
      }
      return handles
    },

    async loadTeam(id: string): Promise<CanonicalTeamConfig> {
      const templates = loadQuickstartTemplates()
      const template = templates[id as keyof typeof templates]
      if (!template) throw new Error(`Quickstart "${id}" not found`)
      return template.team
    },

    async saveTeam(): Promise<TeamHandle> {
      throw new Error("Quickstart repository is read-only")
    },

    async deleteTeam(): Promise<void> {
      throw new Error("Quickstart repository is read-only")
    },
  }
}
