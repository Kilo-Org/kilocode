import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { toolPermission } from "../../src/agent-manager-tool-setting"

const root = path.resolve(import.meta.dir, "../..")

describe("Agent Manager tool setting", () => {
  it("keeps the tool enabled by default", () => {
    expect(toolPermission(true)).toBeUndefined()
  })

  it("denies the tool for new sessions when disabled", () => {
    expect(toolPermission(false)).toEqual([{ permission: "agent_manager", action: "deny", pattern: "*" }])
  })

  it("exposes the default-on toggle in the extension settings UI", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    const properties = pkg.contributes.configuration.properties
    expect(properties["kilo-code.new.agentManager.enableTool"].default).toBe(true)
    expect(properties["kilo-code.new.agentManager.enableTool"].description).toContain(
      "normal subagents remain available independently",
    )

    const tab = fs.readFileSync(path.join(root, "webview-ui/src/components/settings/AgentBehaviourTab.tsx"), "utf8")
    expect(tab).toContain('type: "requestAgentManagerToolSetting"')
    expect(tab).toContain('{ id: "agentManager", labelKey: "settings.agentBehaviour.subtab.agentManager" }')
    expect(tab).toContain('case "agentManager"')
    expect(tab).toContain('key: "agentManager.enableTool"')

    const provider = fs.readFileSync(path.join(root, "src/KiloProvider.ts"), "utf8")
    expect(provider).toContain('case "requestAgentManagerToolSetting"')
    expect(provider).toContain('type: "agentManagerToolSettingLoaded"')
  })
})
