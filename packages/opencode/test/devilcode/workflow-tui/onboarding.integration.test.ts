import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

// NOTE: Structural assertions only (R3-14) — does NOT invoke real wf.startBuild.
// Cannot runtime-import TUI modules in Bun test (opentui/solid TTY deps).

const WF_TUI = join(import.meta.dir, "../../../src/devilcode/workflow-tui")
const TEAM_SRC = join(import.meta.dir, "../../../src/devilcode/team")

const indexSrc = readFileSync(join(WF_TUI, "index.tsx"), "utf8")

describe("onboarding.integration — first-run wizard flow", () => {
  it("index.tsx imports TeamRepository and createFileSystemTeamRepository", () => {
    expect(indexSrc).toContain("createFileSystemTeamRepository")
    expect(indexSrc).toContain("../team/repository")
  })

  it("onReviewAccept uses teamRepo.saveTeam NOT builder.save (R3-03)", () => {
    // teamRepo.saveTeam("default", config) must be present
    expect(indexSrc).toContain('teamRepo.saveTeam("default"')
    // builder.save should NOT appear in onReviewAccept context
    // (builder.save() takes no args; wizard always uses teamRepo)
    expect(indexSrc).not.toContain('builder.save("default"')
  })

  it("startBuild called fire-and-forget (R3-04) — void prefix, not await", () => {
    expect(indexSrc).toContain("void wf.startBuild(")
    // must NOT be `await wf.startBuild` inside onReviewAccept
    expect(indexSrc).not.toMatch(/await wf\.startBuild/)
  })

  it("onReviewAccept calls wf.markFirstRunComplete after save", () => {
    expect(indexSrc).toContain("wf.markFirstRunComplete()")
  })

  it("onReviewAccept transitions mode to 'workflow' after markFirstRunComplete", () => {
    expect(indexSrc).toContain('setMode("workflow")')
  })

  it("onCancel transitions mode to 'team-builder'", () => {
    expect(indexSrc).toContain('setMode("team-builder")')
  })

  it("first-run check: if !wf.firstRunComplete setMode('onboarding')", () => {
    expect(indexSrc).toContain("wf.firstRunComplete")
    expect(indexSrc).toContain('setMode("onboarding")')
  })

  it("quickstarts built from loadQuickstartTemplates()", () => {
    expect(indexSrc).toContain("loadQuickstartTemplates()")
    expect(indexSrc).toContain("../team/quickstarts")
  })

  it("onLoadQuickstart extracts tpl.team from the template", () => {
    expect(indexSrc).toContain("tpl.team")
  })

  it("teamRepo instantiated inside WorkflowViewInner body — NOT at module scope (R3-13)", () => {
    // teamRepo = createFileSystemTeamRepository() must appear inside function body
    const fnMatch = indexSrc.match(/function WorkflowViewInner\(\)[\s\S]*?(?=^function |\nexport function |\nconst |\Z)/m)
    expect(fnMatch).not.toBeNull()
    const fnBody = fnMatch![0]
    expect(fnBody).toContain("createFileSystemTeamRepository()")
  })
})

describe("onboarding.integration — loadQuickstartTemplates data contract", () => {
  it("loadQuickstartTemplates returns 5 quickstarts", async () => {
    // Static import is fine for pure TS modules with no opentui deps
    const mod = await import(join(TEAM_SRC, "quickstarts/index.ts")) as {
      loadQuickstartTemplates: () => Record<string, { id: string; name: string; description: string; icon: string; team: { enabled: boolean; roles: Record<string, unknown> } }>
    }
    const templates = mod.loadQuickstartTemplates()
    const keys = Object.keys(templates)
    expect(keys.length).toBe(5)
    expect(keys).toContain("solo-enhanced")
    expect(keys).toContain("code-review-pair")
    expect(keys).toContain("full-stack-team")
    expect(keys).toContain("ci-cd-pipeline")
    expect(keys).toContain("research-team")
  })

  it("each quickstart has id, name, description, icon, team", async () => {
    const mod = await import(join(TEAM_SRC, "quickstarts/index.ts")) as {
      loadQuickstartTemplates: () => Record<string, { id: string; name: string; description: string; icon: string; team: { enabled: boolean; roles: Record<string, unknown> } }>
    }
    const templates = mod.loadQuickstartTemplates()
    for (const tpl of Object.values(templates)) {
      expect(typeof tpl.id).toBe("string")
      expect(typeof tpl.name).toBe("string")
      expect(typeof tpl.description).toBe("string")
      expect(typeof tpl.icon).toBe("string")
      expect(tpl.team).toBeDefined()
      expect(tpl.team.enabled).toBe(true)
    }
  })

  it("full-stack-team quickstart has roles object", async () => {
    const mod = await import(join(TEAM_SRC, "quickstarts/index.ts")) as {
      loadQuickstartTemplates: () => Record<string, { id: string; name: string; description: string; icon: string; team: { enabled: boolean; roles: Record<string, unknown> } }>
    }
    const tpl = mod.loadQuickstartTemplates()["full-stack-team"]
    expect(tpl).toBeDefined()
    expect(typeof tpl!.team.roles).toBe("object")
    const roleCount = Object.keys(tpl!.team.roles).length
    expect(roleCount).toBeGreaterThan(0)
  })
})
