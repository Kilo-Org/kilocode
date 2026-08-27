import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const TAB_BAR = path.resolve(import.meta.dir, "../../webview-ui/agent-manager/TabBar.tsx")
const BROWSER_PANEL = path.resolve(import.meta.dir, "../../webview-ui/agent-manager/BrowserPanel.tsx")

describe("Agent Manager diff toggle", () => {
  it("exposes the browser action through an accessible button label", () => {
    const source = fs.readFileSync(TAB_BAR, "utf-8")
    const start = source.indexOf("<Show when={props.browserAutomation()}>")
    const end = source.indexOf("</Show>", start)
    const button = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(button).toContain('aria-label={props.t("agentManager.browser.title")}')
  })

  it("renders a real sandboxed browser document instead of an image", () => {
    const source = fs.readFileSync(BROWSER_PANEL, "utf-8")
    expect(source).toContain("<iframe")
    expect(source).toContain('sandbox="allow-scripts allow-forms allow-same-origin"')
    expect(source).not.toContain("<img")
    expect(source).not.toContain("<canvas")
  })

  it("reloads the visible document on each browser navigation and bridges native element inspection", () => {
    const source = fs.readFileSync(BROWSER_PANEL, "utf-8")
    expect(source).toContain("props.state?.navigation")
    expect(source).toContain("when={identity()}")
    expect(source).toContain('type: "agentManager.browser.input"')
    expect(source).toContain("if (pointing()) input(value, false)")
  })

  it("renders live Git stats rather than pull-request stats", () => {
    const source = fs.readFileSync(TAB_BAR, "utf-8")
    const start = source.indexOf('title={props.t("agentManager.diff.toggle")}')
    const end = source.indexOf("</TooltipKeybind>", start)
    const button = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(button).toContain("<Show when={hasChanges()}>")
    expect(button).toContain("stats()!.files")
    expect(button).toContain("stats()!.additions")
    expect(button).toContain("stats()!.deletions")
    expect(button).not.toContain("props.prStatus()")
    expect(button).not.toContain("pr().additions")
    expect(button).not.toContain("pr().deletions")
  })
})
