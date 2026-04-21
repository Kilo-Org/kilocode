import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { createProjectLocalTeamRepository } from "@/devilcode/team/repositories/project-local"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "devilcode-team-plr-"))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe("createProjectLocalTeamRepository", () => {
  it("listTeams returns empty when .planning/ does not exist", async () => {
    const repo = createProjectLocalTeamRepository({ cwd: tmpDir })
    expect(await repo.listTeams()).toEqual([])
  })

  it("saveTeam creates .planning/team.json and round-trips via loadTeam", async () => {
    const repo = createProjectLocalTeamRepository({ cwd: tmpDir })
    const config = loadQuickstartTemplates()["solo-enhanced"].team
    const handle = await repo.saveTeam("project", config)
    expect(handle.id).toBe("project")
    expect(handle.path).toBe(path.join(tmpDir, ".planning", "team.json"))
    const stat = await fs.stat(handle.path)
    expect(stat.isFile()).toBe(true)
    const loaded = await repo.loadTeam("project")
    expect(Object.keys(loaded.roles).sort()).toEqual(Object.keys(config.roles).sort())
  })

  it("listTeams after save returns a single project handle", async () => {
    const repo = createProjectLocalTeamRepository({ cwd: tmpDir })
    const config = loadQuickstartTemplates()["solo-enhanced"].team
    await repo.saveTeam("project", config)
    const list = await repo.listTeams()
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe("project")
    expect(list[0]?.path).toBe(path.join(tmpDir, ".planning", "team.json"))
  })

  it("saveTeam with non-project id throws", async () => {
    const repo = createProjectLocalTeamRepository({ cwd: tmpDir })
    const config = loadQuickstartTemplates()["solo-enhanced"].team
    await expect(repo.saveTeam("something-else", config)).rejects.toThrow(/project-local repo only supports/)
  })

  it("loadTeam with non-project id throws", async () => {
    const repo = createProjectLocalTeamRepository({ cwd: tmpDir })
    await expect(repo.loadTeam("nope")).rejects.toThrow(/project-local repo only supports/)
  })

  it("loadTeam missing file throws with \"not found\"", async () => {
    const repo = createProjectLocalTeamRepository({ cwd: tmpDir })
    await expect(repo.loadTeam("project")).rejects.toThrow(/not found/)
  })

  it("deleteTeam on missing file is a no-op", async () => {
    const repo = createProjectLocalTeamRepository({ cwd: tmpDir })
    await expect(repo.deleteTeam("project")).resolves.toBeUndefined()
  })

  it("deleteTeam removes the saved file", async () => {
    const repo = createProjectLocalTeamRepository({ cwd: tmpDir })
    const config = loadQuickstartTemplates()["solo-enhanced"].team
    await repo.saveTeam("project", config)
    await repo.deleteTeam("project")
    expect(await repo.listTeams()).toEqual([])
  })
})
