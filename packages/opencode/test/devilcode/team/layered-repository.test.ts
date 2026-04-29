import { describe, it, expect } from "bun:test"
import { createLayeredTeamRepository } from "@/devilcode/team/layered-repository"
import type { TeamRepository, TeamHandle } from "@/devilcode/team/repository"
import type { CanonicalTeamConfig } from "@/devilcode/team/config"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"

function mockRepo(
  name: string,
  teams: Record<string, CanonicalTeamConfig>,
): TeamRepository & { saved: Array<{ id: string; config: CanonicalTeamConfig }>; deleted: string[] } {
  const saved: Array<{ id: string; config: CanonicalTeamConfig }> = []
  const deleted: string[] = []
  return {
    saved,
    deleted,
    async listTeams(): Promise<TeamHandle[]> {
      return Object.entries(teams).map(([id]) => ({
        id,
        name: `${name}:${id}`,
        path: `<mock:${name}:${id}>`,
        updatedAt: "1970-01-01T00:00:00.000Z",
        isQuickstart: name === "quickstart",
      }))
    },
    async loadTeam(id: string): Promise<CanonicalTeamConfig> {
      const t = teams[id]
      if (!t) throw new Error(`Team "${id}" not found`)
      return t
    },
    async saveTeam(id: string, config: CanonicalTeamConfig): Promise<TeamHandle> {
      saved.push({ id, config })
      teams[id] = config
      return {
        id,
        name: `${name}:${id}`,
        path: `<mock:${name}:${id}>`,
        updatedAt: new Date().toISOString(),
        isQuickstart: name === "quickstart",
      }
    },
    async deleteTeam(id: string): Promise<void> {
      deleted.push(id)
      if (!teams[id]) throw new Error(`Team "${id}" not found`)
      delete teams[id]
    },
  }
}

describe("createLayeredTeamRepository", () => {
  const templates = loadQuickstartTemplates()
  const teamProject = templates["solo-enhanced"].team
  const teamUser = templates["code-review-pair"].team
  const teamQuickstart = templates["full-stack-team"].team

  function buildLayers() {
    const project = mockRepo("project", { "team-a": teamProject })
    const user = mockRepo("user", { "team-a": teamUser, "team-b": teamUser })
    const quickstart = mockRepo("quickstart", { "team-a": teamQuickstart, "team-c": teamQuickstart })
    return { project, user, quickstart }
  }

  it("loadTeam returns first-layer hit (project shadows others)", async () => {
    const { project, user, quickstart } = buildLayers()
    const repo = createLayeredTeamRepository({
      layers: [
        { name: "project", repository: project, writable: true },
        { name: "user", repository: user, writable: true },
        { name: "quickstart", repository: quickstart, writable: false },
      ],
    })
    const loaded = await repo.loadTeam("team-a")
    expect(loaded).toEqual(teamProject)
  })

  it("loadTeam walks past not-found errors", async () => {
    const { project, user, quickstart } = buildLayers()
    const repo = createLayeredTeamRepository({
      layers: [
        { name: "project", repository: project, writable: true },
        { name: "user", repository: user, writable: true },
        { name: "quickstart", repository: quickstart, writable: false },
      ],
    })
    const loaded = await repo.loadTeam("team-c")
    expect(loaded).toEqual(teamQuickstart)
  })

  it("loadTeam throws when missing in all layers", async () => {
    const { project, user, quickstart } = buildLayers()
    const repo = createLayeredTeamRepository({
      layers: [
        { name: "project", repository: project, writable: true },
        { name: "user", repository: user, writable: true },
        { name: "quickstart", repository: quickstart, writable: false },
      ],
    })
    await expect(repo.loadTeam("nope")).rejects.toThrow(/not found in any layer/)
  })

  it("listTeams dedups by id using layers[] order (first-wins)", async () => {
    const { project, user, quickstart } = buildLayers()
    const repo = createLayeredTeamRepository({
      layers: [
        { name: "project", repository: project, writable: true },
        { name: "user", repository: user, writable: true },
        { name: "quickstart", repository: quickstart, writable: false },
      ],
    })
    const list = await repo.listTeams()
    expect(list).toHaveLength(3)
    const byId = Object.fromEntries(list.map((h) => [h.id, h]))
    expect(byId["team-a"]?.path).toBe("<mock:project:team-a>")
    expect(byId["team-b"]?.path).toBe("<mock:user:team-b>")
    expect(byId["team-c"]?.path).toBe("<mock:quickstart:team-c>")
  })

  it("saveTeam without defaultWriteLayer writes to first writable layer", async () => {
    const { project, user, quickstart } = buildLayers()
    const repo = createLayeredTeamRepository({
      layers: [
        { name: "project", repository: project, writable: true },
        { name: "user", repository: user, writable: true },
        { name: "quickstart", repository: quickstart, writable: false },
      ],
    })
    await repo.saveTeam("new-team", teamUser)
    expect(project.saved.map((s) => s.id)).toContain("new-team")
    expect(user.saved.map((s) => s.id)).not.toContain("new-team")
  })

  it("saveTeam with defaultWriteLayer writes to the named layer", async () => {
    const { project, user, quickstart } = buildLayers()
    const repo = createLayeredTeamRepository({
      layers: [
        { name: "project", repository: project, writable: true },
        { name: "user", repository: user, writable: true },
        { name: "quickstart", repository: quickstart, writable: false },
      ],
      defaultWriteLayer: "user",
    })
    await repo.saveTeam("new-user-team", teamUser)
    expect(user.saved.map((s) => s.id)).toContain("new-user-team")
    expect(project.saved.map((s) => s.id)).not.toContain("new-user-team")
  })

  it("saveTeamToLayer into a non-writable layer throws", async () => {
    const { project, user, quickstart } = buildLayers()
    const repo = createLayeredTeamRepository({
      layers: [
        { name: "project", repository: project, writable: true },
        { name: "user", repository: user, writable: true },
        { name: "quickstart", repository: quickstart, writable: false },
      ],
    })
    await expect(repo.saveTeamToLayer("quickstart", "x", teamUser)).rejects.toThrow(/not writable/)
  })

  it("saveTeamToLayer with unknown layer name throws", async () => {
    const { project, user, quickstart } = buildLayers()
    const repo = createLayeredTeamRepository({
      layers: [
        { name: "project", repository: project, writable: true },
        { name: "user", repository: user, writable: true },
        { name: "quickstart", repository: quickstart, writable: false },
      ],
    })
    await expect(repo.saveTeamToLayer("nowhere", "x", teamUser)).rejects.toThrow(/not found/)
  })

  it("saveTeam throws when no writable layer exists", async () => {
    const quickstart = mockRepo("quickstart", { "team-x": teamQuickstart })
    const repo = createLayeredTeamRepository({
      layers: [{ name: "quickstart", repository: quickstart, writable: false }],
    })
    await expect(repo.saveTeam("foo", teamQuickstart)).rejects.toThrow(/No writable layer/)
  })
})
