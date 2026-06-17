import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Project, SyntaxKind } from "ts-morph"

const ROOT = join(import.meta.dir, "../..")
const APP = join(ROOT, "webview-ui/agent-manager/AgentManagerApp.tsx")
const css = readFileSync(join(ROOT, "webview-ui/agent-manager/agent-manager.css"), "utf8")
const cloud = readFileSync(join(ROOT, "webview-ui/agent-manager/cloud-agent/CloudAgentSection.tsx"), "utf8")
const project = new Project({ compilerOptions: { allowJs: true } })
const source = project.addSourceFileAtPath(APP)
const elements = source.getDescendantsOfKind(SyntaxKind.JsxElement)
const stack = elements.find((node) => node.getOpeningElement().getText().includes('class="am-session-sections"'))

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s"))
  expect(match, `CSS rule not found: ${selector}`).toBeTruthy()
  return match![1]!
}

describe("Agent Manager session section layout", () => {
  it("groups local and cloud sessions into a shared collapsed-aware stack", () => {
    expect(stack).toBeDefined()
    expect(stack!.getOpeningElement().getText()).toContain(
      '"am-session-sections-collapsed": sessionsCollapsed() && cloud.collapsed()',
    )
    expect(stack!.getText()).toContain('{t("agentManager.section.sessions")}')
    expect(stack!.getText()).toContain("<CloudAgentSection")
  })

  it("hugs content, preserves headers, and leaves space below expanded sections", () => {
    expect(rule(".am-session-sections")).toContain("margin-bottom: auto;")
    expect(rule(".am-session-sections-collapsed")).toContain("margin-top: auto;")
    expect(rule(".am-session-sections-collapsed")).toContain("margin-bottom: 0;")
    expect(rule(".am-session-sections > .am-section")).toContain("display: contents;")
    expect(rule(".am-section-header")).toContain("flex-shrink: 0;")
  })

  it("only lets worktrees grow when both session sections are collapsed", () => {
    const worktrees = elements.find(
      (node) =>
        node.getOpeningElement().getText().includes('class="am-section"') &&
        node.getText().includes('{t("agentManager.section.worktrees")}'),
    )

    expect(worktrees).toBeDefined()
    expect(stack).toBeDefined()
    expect(worktrees!.getOpeningElement().getText()).toContain(
      '"am-section-grow": sessionsCollapsed() && cloud.collapsed()',
    )
    expect(stack!.getText()).not.toContain("am-section-grow")
    expect(cloud).not.toContain("am-section-grow")
  })
})
