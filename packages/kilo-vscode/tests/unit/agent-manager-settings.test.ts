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

  it("stages application-wide branch naming controls outside the project selection", () => {
    expect(settings).toContain('updateSetting("agentManager.autoBranchNaming", value)')
    expect(settings).toContain('updateSetting("agentManager.branchPrefix", value)')
    expect(settings.indexOf('title={language.t("agentManager.settings.branchPrefix.title")}')).toBeLessThan(
      settings.indexOf("<Show when={project()}"),
    )
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

describe("Agent Manager application settings", () => {
  it.each([
    [undefined, undefined, true, ""],
    [false, "team/", false, "team/"],
    [true, "", true, ""],
  ] as const)("loads and saves naming preferences (%s, %s)", async (enabled, prefix, expected, text) => {
    const vscode = await import("vscode")
    const { KiloProvider } = await import("../../src/KiloProvider")
    const original = vscode.workspace.getConfiguration
    const values = new Map<string, unknown>()
    if (enabled !== undefined) values.set("autoBranchNaming", enabled)
    if (prefix !== undefined) values.set("branchPrefix", prefix)
    const writes: unknown[] = []
    vscode.workspace.getConfiguration = ((section?: string) => ({
      get: (key: string, fallback: unknown) =>
        section === "kilo-code.new.agentManager" && values.has(key) ? values.get(key) : fallback,
      update: async (key: string, value: unknown, target: unknown) => {
        writes.push({ section, key, value, target })
        values.set(key, value)
      },
    })) as typeof original
    try {
      const provider = new KiloProvider({} as never, {} as never) as unknown as {
        configSettings(): Record<string, unknown>
        handleUpdateSetting(key: string, value: unknown): Promise<void>
      }
      expect(provider.configSettings()["agentManager.autoBranchNaming"]).toBe(expected)
      expect(provider.configSettings()["agentManager.branchPrefix"]).toBe(text)
      await provider.handleUpdateSetting("agentManager.autoBranchNaming", !expected)
      await provider.handleUpdateSetting("agentManager.branchPrefix", "")
      expect(writes).toEqual([
        {
          section: "kilo-code.new.agentManager",
          key: "autoBranchNaming",
          value: !expected,
          target: vscode.ConfigurationTarget.Global,
        },
        {
          section: "kilo-code.new.agentManager",
          key: "branchPrefix",
          value: "",
          target: vscode.ConfigurationTarget.Global,
        },
      ])
      expect(provider.configSettings()["agentManager.autoBranchNaming"]).toBe(!expected)
      expect(provider.configSettings()["agentManager.branchPrefix"]).toBe("")
    } finally {
      vscode.workspace.getConfiguration = original
    }
  })
})
