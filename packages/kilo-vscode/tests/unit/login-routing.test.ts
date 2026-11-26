import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { fixture } from "../fixtures/run"

const ROOT = path.resolve(import.meta.dir, "../..")

describe("Agent Manager sign-in routing", () => {
  it(
    "routes ErrorDisplay Sign in through openProfilePanel in Agent Manager while preserving inline login elsewhere",
    () => fixture("login-routing"),
    30_000,
  )

  it("wires Agent Manager interception, project-less openProfilePanel passthrough, and Profile login refresh", () => {
    const amApp = fs.readFileSync(path.join(ROOT, "webview-ui/agent-manager/AgentManagerApp.tsx"), "utf-8")
    const amProvider = fs.readFileSync(path.join(ROOT, "src/agent-manager/AgentManagerProvider.ts"), "utf-8")
    const app = fs.readFileSync(path.join(ROOT, "webview-ui/src/App.tsx"), "utf-8")

    expect(amApp).toContain('interceptLogin(() => vscode.postMessage({ type: "openProfilePanel", login: true }))')
    expect(amProvider.indexOf('if (msg.type === "openProfilePanel") return msg')).toBeLessThan(
      amProvider.indexOf("this.messageProject(m)"),
    )
    expect(app).toContain('if (message.view === "profile" && message.focus === "login")')
    expect(app).toContain('vscode.postMessage({ type: "refreshProfile" })')
    expect(app).toContain("server.startLogin()")
  })
})
