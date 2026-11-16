import { describe, expect, test } from "bun:test"
import { html } from "../src/chat"

const base = {
  csp: "vscode-webview:",
  script: "webview.js",
  style: "webview.css",
  icons: "icons",
  worker: "worker.js",
  markdown: "markdown.js",
  directory: "/tmp/project",
  size: 13,
  language: "en",
  version: "0.0.0",
  settings: {},
}

const surface = (view: "chat" | "settings" | "profile" | "marketplace" | "agentManager") => {
  const match = html({ ...base, view }).match(/body \{ background-color: ([^;]+);/)
  if (!match) throw new Error(`no body background for ${view}`)
  return match[1]
}

const page = (view: "chat" | "settings" | "profile" | "marketplace" | "agentManager") => html({ ...base, view })

describe("webview script loading", () => {
  test("only the Settings, Profile and Marketplace panels load an ES module", () => {
    expect(page("settings")).toContain('type="module"')
    expect(page("profile")).toContain('type="module"')
    expect(page("marketplace")).toContain('type="module"')
    expect(page("chat")).not.toContain('type="module"')
    expect(page("agentManager")).not.toContain('type="module"')
  })

  test("only the module panels allow their chunks with strict-dynamic", () => {
    expect(page("settings")).toContain("'strict-dynamic'")
    expect(page("profile")).toContain("'strict-dynamic'")
    expect(page("marketplace")).toContain("'strict-dynamic'")
    expect(page("chat")).not.toContain("'strict-dynamic'")
    expect(page("agentManager")).not.toContain("'strict-dynamic'")
  })
})

describe("webview body surface", () => {
  test("the sidebar and the Agent Manager share the sidebar background", () => {
    const sidebar = "var(--vscode-sideBar-background, var(--vscode-editor-background))"
    expect(surface("chat")).toBe(sidebar)
    expect(surface("agentManager")).toBe(sidebar)
  })

  test("the Settings, Profile and Marketplace panels keep the editor background", () => {
    expect(surface("settings")).toBe("var(--vscode-editor-background)")
    expect(surface("profile")).toBe("var(--vscode-editor-background)")
    expect(surface("marketplace")).toBe("var(--vscode-editor-background)")
  })
})

describe("webview sidebar edge", () => {
  test("only the sidebar view carries the physical workbench edge", () => {
    expect(html({ ...base, view: "chat", sidebar: "left" })).toContain('data-sidebar="left"')
    expect(html({ ...base, view: "chat", sidebar: "right" })).toContain('data-sidebar="right"')
    expect(page("chat")).toContain('data-sidebar=""')
    expect(page("agentManager")).toContain('data-sidebar=""')
  })
})

describe("webview chat surface", () => {
  test("the sidebar is the default surface, with no bound session", () => {
    expect(page("chat")).toContain('window.KILO_SURFACE = "sidebar"')
    expect(page("chat")).toContain("window.KILO_SESSION_ID = null")
  })

  test("a chat editor tab carries its surface and the session it opens on", () => {
    const editor = (sessionID: string | null) => html({ ...base, view: "chat", surface: "editor", sessionID })
    expect(editor("ses_a")).toContain('window.KILO_SURFACE = "editor"')
    expect(editor("ses_a")).toContain('window.KILO_SESSION_ID = "ses_a"')
    expect(editor(null)).toContain("window.KILO_SESSION_ID = null")
  })
})
