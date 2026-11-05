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

const surface = (view: "chat" | "settings" | "profile" | "agentManager") => {
  const match = html({ ...base, view }).match(/body \{ background-color: ([^;]+);/)
  if (!match) throw new Error(`no body background for ${view}`)
  return match[1]
}

describe("webview body surface", () => {
  test("the sidebar and the Agent Manager share the sidebar background", () => {
    const sidebar = "var(--vscode-sideBar-background, var(--vscode-editor-background))"
    expect(surface("chat")).toBe(sidebar)
    expect(surface("agentManager")).toBe(sidebar)
  })

  test("the Settings and Profile panels keep the editor background", () => {
    expect(surface("settings")).toBe("var(--vscode-editor-background)")
    expect(surface("profile")).toBe("var(--vscode-editor-background)")
  })
})
