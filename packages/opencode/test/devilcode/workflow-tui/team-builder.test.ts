import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { createFileSystemTeamRepository } from "@/devilcode/team/repository"
import { loadQuickstartTemplates } from "@/devilcode/team/quickstarts"
import { CanonicalTeamConfig } from "@/devilcode/team/config"

let tmpRoot: string

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "team-builder-round-trip-"))
})

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe("Team builder round-trip integration", () => {
  it("load-quickstart → edit → validate → save → reload produces identical config", async () => {
    const repo = createFileSystemTeamRepository({ rootDir: tmpRoot })
    const tpl = loadQuickstartTemplates()["solo-enhanced"]
    const draft: any = { ...tpl.team, enabled: false }
    const firstRoleKey = Object.keys(draft.roles)[0]!
    draft.roles[firstRoleKey] = { ...draft.roles[firstRoleKey], provider: "anthropic", model: "claude-sonnet-4-20250514" }
    const validated = CanonicalTeamConfig.parse({ ...draft, enabled: true })
    expect(validated.enabled).toBe(true)
    await repo.saveTeam("solo-test", validated)
    const loaded = await repo.loadTeam("solo-test")
    expect(loaded.routing.defaultRole).toBe(validated.routing.defaultRole)
    expect(Object.keys(loaded.roles).sort()).toEqual(Object.keys(validated.roles).sort())
    expect(loaded.roles[firstRoleKey]!.provider).toBe("anthropic")
    expect(loaded.roles[firstRoleKey]!.model).toBe("claude-sonnet-4-20250514")
  })

  it("all 5 quickstarts round-trip without modification", async () => {
    const repo = createFileSystemTeamRepository({ rootDir: tmpRoot })
    const templates = loadQuickstartTemplates()
    for (const [id, tpl] of Object.entries(templates)) {
      await repo.saveTeam(id, { ...tpl.team, enabled: true })
      const loaded = await repo.loadTeam(id)
      expect(loaded.routing.defaultRole).toBe(tpl.team.routing.defaultRole)
      expect(loaded.enabled).toBe(true)
    }
  })

  it("saving an invalid config throws ZodError", async () => {
    const repo = createFileSystemTeamRepository({ rootDir: tmpRoot })
    const invalid = {
      enabled: true,
      roles: {},
      routing: { strategy: "hierarchical" as const, defaultRole: "architect" as const, escalationEnabled: true },
    }
    await expect(repo.saveTeam("empty", invalid as any)).rejects.toThrow()
  })

  it("tampered file with missing release capability fails on reload", async () => {
    const repo = createFileSystemTeamRepository({ rootDir: tmpRoot })
    const tpl = loadQuickstartTemplates()["full-stack-team"]
    await repo.saveTeam("fst", { ...tpl.team, enabled: true })
    const filePath = path.join(tmpRoot, "fst.json")
    const raw = JSON.parse(await fs.readFile(filePath, "utf-8"))
    for (const roleKey of Object.keys(raw.roles)) {
      raw.roles[roleKey].capabilities = raw.roles[roleKey].capabilities.filter((c: string) => c !== "release")
    }
    await fs.writeFile(filePath, JSON.stringify(raw))
    await expect(repo.loadTeam("fst")).rejects.toThrow()
  })
})
