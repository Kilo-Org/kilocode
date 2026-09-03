import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")

describe("Agent Manager settings navigation", () => {
  const actions = readFileSync(join(ROOT, "webview-ui", "agent-manager", "ProjectActions.tsx"), "utf8")
  const project = readFileSync(join(ROOT, "webview-ui", "agent-manager", "ProjectSidebarBody.tsx"), "utf8")
  const settings = readFileSync(join(ROOT, "webview-ui", "src", "components", "settings", "Settings.tsx"), "utf8")
  const branchDialog = readFileSync(join(ROOT, "webview-ui", "agent-manager", "ProjectBranchDialog.tsx"), "utf8")

  it("opens the project settings tab with the owning project id", () => {
    expect(actions).toContain("onClick={props.onSettings}")
    expect(project).toContain('tab: "agentManager"')
    expect(project).toContain("projectId: props.project.id")
  })

  it("renders a project selector and project-scoped settings controls", () => {
    expect(settings).toContain('type: "requestAgentManagerSettings"')
    expect(settings).toContain('type: "requestAgentManagerSettingsBranches"')
    expect(settings).toContain('type: "setAgentManagerDefaultBaseBranch"')
    expect(settings).toContain('type: "configureAgentManagerSetupScript"')
  })

  it("keeps the repository default branch selectable without an empty value", () => {
    expect(settings).toContain("<ProjectBranchDialog")
    expect(branchDialog).toContain('label: language.t("agentManager.worktree.defaultBaseBranchAuto")')
    expect(branchDialog).toContain("onSelect: () => select()")
  })

  it("places the Agent Manager settings tab under Auto-Approve", () => {
    const autoApprove = settings.indexOf('value="autoApprove"')
    const agentManager = settings.indexOf('value="agentManager"')
    const browser = settings.indexOf('value="browser"')
    expect(autoApprove).toBeGreaterThan(-1)
    expect(autoApprove).toBeLessThan(agentManager)
    expect(agentManager).toBeLessThan(browser)
  })

  it("loads branches only when the default branch picker opens", () => {
    expect(settings).toContain("loadBranches(id)")
    expect(settings).toContain("dialog.show(() =>")
  })

  it("opens the existing branch picker dialog", () => {
    expect(settings).toContain("dialog.show(() =>")
    expect(settings).toContain("<ProjectBranchDialog")
  })
})
