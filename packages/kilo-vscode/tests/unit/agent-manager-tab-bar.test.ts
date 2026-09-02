import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const TAB_BAR = path.resolve(import.meta.dir, "../../webview-ui/agent-manager/TabBar.tsx")
const BROWSER_PANEL = path.resolve(import.meta.dir, "../../webview-ui/browser/BrowserPanel.tsx")
const BROWSER_ADAPTER = path.resolve(import.meta.dir, "../../webview-ui/agent-manager/BrowserPanel.tsx")

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
    expect(source).not.toContain("contentWindow")
    expect(source).toContain("onMouseMove={(event) => props.controller.move(position(event))}")
    expect(fs.readFileSync(BROWSER_ADAPTER, "utf-8")).toContain('type: "agentManager.browser.input"')
  })

  it("keeps browser chrome compact with one close action and no duplicate footer", () => {
    const source = fs.readFileSync(BROWSER_PANEL, "utf-8")
    expect(source).toContain('class="am-browser-address"')
    expect(source).toContain('icon="arrow-right"')
    expect(source).toContain('icon="window-cursor"')
    expect(source.match(/icon="close"/g)).toHaveLength(1)
    expect(source).not.toContain("am-browser-footer")
    expect(source).not.toContain("am-browser-selected")
    expect(source).not.toContain("am-browser-devtools-toolbar")
  })

  it("passes selected references through the host adapter", () => {
    const source = fs.readFileSync(BROWSER_ADAPTER, "utf-8")
    expect(source).toContain("onReference={reference}")
    expect(source).toContain('import { post } from "../src/utils/webview-message"')
    expect(source).toContain('post({ type: "appendChatBoxMessage"')
    expect(source).toContain("const labels = createMemo(")
    expect(source).toContain("theme={theme}")
    expect(source).not.toContain("window.postMessage")
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
