import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { createFileSystemTeamRepository } from "@/devilcode/team/repository"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"

let tmpRoot: string

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "team-repo-"))
})

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe("FileSystemTeamRepository", () => {
  it("listTeams returns empty array when directory does not exist", async () => {
    const repo = createFileSystemTeamRepository({ rootDir: path.join(tmpRoot, "nope") })
    expect(await repo.listTeams()).toEqual([])
  })

  it("saveTeam creates parent directory (Windows-safe mkdir -p)", async () => {
    const nestedRoot = path.join(tmpRoot, "deeply", "nested", "teams")
    const repo = createFileSystemTeamRepository({ rootDir: nestedRoot })
    const config = loadQuickstartTemplates()["solo-enhanced"].team
    const handle = await repo.saveTeam("my-team", config)
    expect(handle.id).toBe("my-team")
    expect(handle.path).toBe(path.join(nestedRoot, "my-team.json"))
    const stat = await fs.stat(handle.path)
    expect(stat.isFile()).toBe(true)
  })

  it("save then load round-trips a quickstart template", async () => {
    const repo = createFileSystemTeamRepository({ rootDir: tmpRoot })
    const original = loadQuickstartTemplates()["full-stack-team"].team
    await repo.saveTeam("full-stack", original)
    const loaded = await repo.loadTeam("full-stack")
    expect(loaded.routing.defaultRole).toBe(original.routing.defaultRole)
    expect(Object.keys(loaded.roles).sort()).toEqual(Object.keys(original.roles).sort())
  })

  it("loadTeam throws on malformed JSON schema", async () => {
    const repo = createFileSystemTeamRepository({ rootDir: tmpRoot })
    await fs.writeFile(path.join(tmpRoot, "broken.json"), JSON.stringify({ enabled: true, roles: {} }))
    await expect(repo.loadTeam("broken")).rejects.toThrow()
  })

  it("listTeams sorts by id and includes updatedAt", async () => {
    const repo = createFileSystemTeamRepository({ rootDir: tmpRoot })
    const t1 = loadQuickstartTemplates()["solo-enhanced"].team
    const t2 = loadQuickstartTemplates()["code-review-pair"].team
    await repo.saveTeam("zeta", t1)
    await repo.saveTeam("alpha", t2)
    const list = await repo.listTeams()
    expect(list.map((h) => h.id)).toEqual(["alpha", "zeta"])
    expect(list[0]!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("rejects invalid team id characters", async () => {
    const repo = createFileSystemTeamRepository({ rootDir: tmpRoot })
    const config = loadQuickstartTemplates()["solo-enhanced"].team
    await expect(repo.saveTeam("../escape", config)).rejects.toThrow(/Invalid team id/)
    await expect(repo.saveTeam("with space", config)).rejects.toThrow(/Invalid team id/)
  })

  it("deleteTeam removes the file", async () => {
    const repo = createFileSystemTeamRepository({ rootDir: tmpRoot })
    const config = loadQuickstartTemplates()["solo-enhanced"].team
    await repo.saveTeam("doomed", config)
    await repo.deleteTeam("doomed")
    expect(await repo.listTeams()).toEqual([])
  })
})
