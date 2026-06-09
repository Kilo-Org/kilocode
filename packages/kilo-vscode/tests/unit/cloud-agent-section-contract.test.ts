import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "../..")
const source = readFileSync(join(ROOT, "webview-ui/agent-manager/cloud-agent/CloudAgentSection.tsx"), "utf8")
const app = readFileSync(join(ROOT, "webview-ui/agent-manager/AgentManagerApp.tsx"), "utf8")
const state = readFileSync(join(ROOT, "webview-ui/agent-manager/cloud-agent/session-state.ts"), "utf8")
const provider = readFileSync(join(ROOT, "src/agent-manager/AgentManagerProvider.ts"), "utf8")
const css = readFileSync(join(ROOT, "webview-ui/agent-manager/agent-manager.css"), "utf8")
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))

describe("Cloud Agent discovery section contract", () => {
  it("is disabled by default behind an experimental extension setting", () => {
    const setting = pkg.contributes.configuration.properties["kilo-code.new.experimental.cloudAgent.enabled"]

    expect(setting.type).toBe("boolean")
    expect(setting.default).toBe(false)
    expect(setting.description).toContain("experimental")
  })

  it("transports the setting and gates Cloud Agent rendering and requests", () => {
    expect(provider).toContain("cloudAgentEnabled: this.host.cloudAgentEnabled()")
    expect(app).toContain("cloud.enable(state.cloudAgentEnabled === true, cloudDialog.close)")
    expect(state).toContain("if (value) return request()")
    expect(state).toContain("if (!enabled()) return")
    expect(app).toContain("<Show when={cloud.enabled()}>")
    expect(app).not.toContain("    cloud.request()\n")
  })

  it("renders visible discovery rows instead of retained sessions directly", () => {
    expect(source).toContain("<For each={props.state.visible()}>")
    expect(source).not.toContain("<For each={props.state.sessions()}>")
  })

  it("keeps normal discovery rows behind the signed-out branch", () => {
    const branch = source.indexOf('when={props.state.status() !== "signed-out"}')
    const fallback = source.indexOf('props.t("agentManager.cloud.signedOut")')
    const rows = source.indexOf("<For each={props.state.visible()}>")

    expect(branch).toBeGreaterThan(-1)
    expect(fallback).toBeGreaterThan(branch)
    expect(rows).toBeGreaterThan(fallback)
  })

  it("identifies an empty discovery result with its repository when available", () => {
    expect(source).toContain('props.t("agentManager.cloud.emptyRepository", { repository: props.state.repository()! })')
    expect(source).toContain(': props.t("agentManager.cloud.empty")')
  })

  it("aligns every discovery state message with the section label without shifting rows", () => {
    expect(source).toContain(
      'class="am-empty-state-text am-cloud-list-state">{props.t("agentManager.cloud.signedOut")}',
    )
    expect(source).toContain('class="am-item-time am-cloud-list-state">{props.t("agentManager.cloud.loading")}')
    expect(source).toMatch(/class="am-item-time am-cloud-list-state">\s*\{props\.state\.repository\(\)/)
    expect(source).toMatch(/class="am-empty-state-text am-cloud-list-state">\s*<span>\{props\.state\.error\(\)/)
    expect(source).not.toContain("am-item am-cloud-list-state")
    expect(css).toContain(`.am-cloud-list-state {
  padding-inline-start: 26px;
}`)
    expect(css).toContain(`.am-item-time.am-cloud-list-state {
  overflow-wrap: anywhere;
  white-space: normal;
}`)
  })

  it("uses explicit retry from the retryable error affordance", () => {
    const start = source.indexOf('<Show when={props.state.status() === "error"}>')
    const end = source.indexOf("</Show>", start)
    const error = source.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(error).toContain("onClick={() => props.state.retry()}")
    expect(error).not.toContain("onClick={() => props.state.request()}")
  })

  it("renders a separate add action beside the collapsible heading", () => {
    expect(source).toContain("onCreate: () => void")
    expect(source).toContain('icon="plus"')
    expect(source).toContain("onClick={() => props.onCreate()}")
    expect(source.indexOf('<button class="am-section-toggle"')).toBeGreaterThan(-1)
    expect(source.indexOf("<IconButton")).toBeGreaterThan(source.indexOf("</button>"))
  })
})
