import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const path = join(__dirname, "..", "..", "webview-ui", "src", "components", "chat", "PromptInput.tsx")
const src = readFileSync(path, "utf8")
const cssPath = join(__dirname, "..", "..", "webview-ui", "src", "styles", "prompt-input.css")
const css = readFileSync(cssPath, "utf8")
const dialogPath = join(__dirname, "..", "..", "webview-ui", "agent-manager", "NewWorktreeDialog.tsx")
const dialog = readFileSync(dialogPath, "utf8")

describe("PromptInput bidirectional text support", () => {
  it("lets the textarea and visible overlay resolve text direction automatically", () => {
    const overlay = src.match(/<div class="prompt-input-highlight-overlay"[\s\S]*?>/)?.[0]
    const overlayCss = css.match(/\.prompt-input-highlight-overlay\s*{[^}]*}/)?.[0]
    const input = src.match(/<textarea[\s\S]*?\n\s*\/>/)?.[0]

    expect(overlay).toContain('dir="auto"')
    expect(overlayCss).toContain("unicode-bidi: plaintext")
    expect(input).toContain('class="prompt-input"')
    expect(input).toContain('dir="auto"')
  })

  it("lets the Agent Manager worktree prompt resolve bidirectional text automatically", () => {
    const input = dialog.match(/<textarea[\s\S]*?class="prompt-input am-prompt-input"[\s\S]*?\n\s*\/>/)?.[0]

    expect(input).toContain('dir="auto"')
  })
})
