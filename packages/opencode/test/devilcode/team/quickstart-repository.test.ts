import { describe, it, expect } from "bun:test"
import { createQuickstartTeamRepository } from "@/devilcode/team/repositories/quickstart"
import { QUICKSTART_IDS } from "@/devilcode/team/quickstarts"

describe("createQuickstartTeamRepository", () => {
  it("listTeams returns all 5 quickstart entries with matching ids", async () => {
    const repo = createQuickstartTeamRepository()
    const list = await repo.listTeams()
    expect(list).toHaveLength(5)
    const ids = list.map((h) => h.id).sort()
    expect(ids).toEqual([...QUICKSTART_IDS].sort())
    for (const handle of list) {
      expect(handle.path).toBe(`<bundled:${handle.id}>`)
      expect(handle.updatedAt).toBe("1970-01-01T00:00:00.000Z")
    }
  })

  it("loadTeam returns a CanonicalTeamConfig with a roles object", async () => {
    const repo = createQuickstartTeamRepository()
    const team = await repo.loadTeam("solo-enhanced")
    expect(team.roles).toBeDefined()
    expect(typeof team.roles).toBe("object")
    expect(Array.isArray(team.roles)).toBe(false)
    expect(Object.keys(team.roles).length).toBeGreaterThan(0)
  })

  it("loadTeam with missing id throws with \"not found\" in message", async () => {
    const repo = createQuickstartTeamRepository()
    await expect(repo.loadTeam("missing-id")).rejects.toThrow(/not found/)
  })

  it("saveTeam throws with \"read-only\" in message", async () => {
    const repo = createQuickstartTeamRepository()
    const team = await repo.loadTeam("solo-enhanced")
    await expect(repo.saveTeam("foo", team)).rejects.toThrow(/read-only/)
  })

  it("deleteTeam throws with \"read-only\" in message", async () => {
    const repo = createQuickstartTeamRepository()
    await expect(repo.deleteTeam("solo-enhanced")).rejects.toThrow(/read-only/)
  })
})
