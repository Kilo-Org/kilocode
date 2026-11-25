import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { handleSidebarWorktreeMessage } from "../../src/kilo-provider/sidebar-worktree"
import { fixture } from "../fixtures/run"

const ROOT = path.resolve(import.meta.dir, "../..")

describe("Agent Manager sign-in routing", () => {
  it(
    "routes ErrorDisplay Sign in through openProfilePanel in Agent Manager while preserving inline login elsewhere",
    () => fixture("login-routing"),
    30_000,
  )

  it("forwards login flag from openProfilePanel in handleSidebarWorktreeMessage", async () => {
    const calls: Array<boolean | undefined> = []
    const ctx = {
      post: () => {},
      openAgentManager: () => Promise.resolve(),
      openAdvancedWorktree: () => Promise.resolve(),
      openChanges: () => Promise.resolve(),
      openProfile: (login?: boolean) => {
        calls.push(login)
        return Promise.resolve()
      },
    }

    expect(await handleSidebarWorktreeMessage({ type: "openProfilePanel" }, ctx)).toBe(true)
    expect(await handleSidebarWorktreeMessage({ type: "openProfilePanel", login: false }, ctx)).toBe(true)
    expect(await handleSidebarWorktreeMessage({ type: "openProfilePanel", login: true }, ctx)).toBe(true)
    expect(calls).toEqual([false, false, true])
  })

  it("wires Agent Manager, extension command, SettingsEditorProvider, and App for Profile panel sign-in", () => {
    const amApp = fs.readFileSync(path.join(ROOT, "webview-ui/agent-manager/AgentManagerApp.tsx"), "utf-8")
    const amProvider = fs.readFileSync(path.join(ROOT, "src/agent-manager/AgentManagerProvider.ts"), "utf-8")
    const ext = fs.readFileSync(path.join(ROOT, "src/extension.ts"), "utf-8")
    const settings = fs.readFileSync(path.join(ROOT, "src/SettingsEditorProvider.ts"), "utf-8")
    const app = fs.readFileSync(path.join(ROOT, "webview-ui/src/App.tsx"), "utf-8")

    expect(amApp).toContain('interceptLogin(() => vscode.postMessage({ type: "openProfilePanel", login: true }))')
    expect(amProvider.indexOf('if (msg.type === "openProfilePanel") return msg')).toBeLessThan(
      amProvider.indexOf("this.messageProject(m)"),
    )
    expect(ext).toContain('vscode.commands.registerCommand("kilo-code.new.profileButtonClicked", (login?: unknown)')
    expect(ext).toContain("if (login === true)")
    expect(ext).toContain("settingsEditorProvider.openProfileLogin()")
    expect(settings).toContain("openProfileLogin(): void")
    expect(settings).toContain('provider.postMessage({ type: "action", action: "startLogin" })')
    expect(app).toContain('case "startLogin":')
    expect(app).toContain("server.startLogin()")
  })
})
