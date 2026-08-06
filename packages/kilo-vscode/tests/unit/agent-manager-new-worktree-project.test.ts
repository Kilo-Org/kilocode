import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(__dirname, "..", "..")
const dialog = readFileSync(join(root, "webview-ui", "agent-manager", "NewWorktreeDialog.tsx"), "utf8")
const app = readFileSync(join(root, "webview-ui", "agent-manager", "AgentManagerApp.tsx"), "utf8")
const pending = readFileSync(join(root, "webview-ui", "agent-manager", "pending-create.ts"), "utf8")
const importer = readFileSync(join(root, "src", "agent-manager", "worktree-importer.ts"), "utf8")
const css = readFileSync(join(root, "webview-ui", "agent-manager", "agent-manager.css"), "utf8")

describe("Agent Manager New Worktree project targeting", () => {
  it("routes dialog operations through the selected project and rejects stale responses", () => {
    expect(dialog).toContain("const [project, setProject]")
    expect(dialog).toContain("if (ev.projectId !== project()) return")
    expect(dialog).toContain('type: "agentManager.requestBranches", projectId: id')
    expect(dialog).toContain('type: "agentManager.createMultiVersion"')
    expect(dialog).toContain("projectId: target")
    expect(dialog).toContain('type: "agentManager.importFromPR"')
    expect(dialog).toContain('type: "agentManager.importFromBranch"')
  })

  it("does not replace a pending cross-project activation", () => {
    expect(pending).toContain("if (pending()) return")
    expect(app).toContain("usePendingCreate(activeProjectId")
    expect(app).toContain('msg.type === "agentManager.importResult"')
    expect(app).toContain("!msg.success) creation.abandon(msg.projectId)")
  })

  it("tags branch and import responses with their owning project", () => {
    expect(importer).toContain("async branches(projectId?: string)")
    expect(importer).toContain('type: "agentManager.branches", projectId')
    expect(importer).toContain('type: "agentManager.importResult", projectId')
    expect(importer).toContain('type: "agentManager.worktreeSetup", projectId')
  })

  it("keeps the project picker aligned with the dialog selector system", () => {
    expect(css).toContain(".am-nv-project-inline")
    expect(css).toContain(".am-project-option")
    expect(css).toContain('[data-component="dialog"]:has(.am-nv-project-inline [data-component="popover-content"])')
  })

  it("defines project labels in every Agent Manager locale", () => {
    const keys = [
      "agentManager.dialog.project.select",
      "agentManager.dialog.project.untrusted",
      "agentManager.dialog.project.missing",
    ]
    const locales = readdirSync(join(root, "webview-ui", "agent-manager", "i18n")).filter((file) =>
      file.endsWith(".ts"),
    )

    for (const file of locales) {
      const source = readFileSync(join(root, "webview-ui", "agent-manager", "i18n", file), "utf8")
      for (const key of keys) expect(source, `${file} is missing ${key}`).toContain(`"${key}"`)
    }
  })
})
