import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const path = join(__dirname, "..", "..", "webview-ui", "src", "components", "chat", "PromptInput.tsx")
const src = readFileSync(path, "utf8")

describe("PromptInput connection guard", () => {
  it("rechecks the connection after resolving async attachments and before clearing the draft", () => {
    const attachments = src.indexOf("const gitFile = await git.resolveAttachment")
    const guard = src.indexOf("if (isDisabled()) return", attachments)
    const send = src.indexOf("session.sendMessage(message", guard)
    const clear = src.indexOf("drafts.delete(key)", send)

    expect(attachments).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(attachments)
    expect(send).toBeGreaterThan(guard)
    expect(clear).toBeGreaterThan(send)
  })
})

describe("PromptInput sandbox toggle", () => {
  it("writes only the sandbox patch without saving pending settings drafts", () => {
    const start = src.indexOf("<Show when={features().sandboxControls}>")
    const end = src.indexOf("</Show>", start)
    const toggle = src.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(toggle).toContain("vscode.postMessage({")
    expect(toggle).toContain('type: "updateConfig"')
    expect(toggle).toContain("config: { experimental: { sandbox: !sandbox() } }")
    expect(toggle).not.toContain("saveConfig")
    expect(toggle).not.toContain("updateConfig(")
  })
})
