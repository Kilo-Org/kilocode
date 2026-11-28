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
  it("paints plain text in the textarea and decorations in the overlay", () => {
    const manager = readFileSync(join(__dirname, "../../webview-ui/agent-manager/agent-manager.css"), "utf8")
    const color = (sheet: string, selector: string) =>
      sheet.match(new RegExp(`^${selector}\\s*\\{[^}]*?^\\s*color:\\s*([^;]+);`, "m"))?.[1]

    // A fallback such as `var(--vscode-input-foreground, var(--text-base))` is still plain text.
    expect(color(css, "\\.prompt-input")).toContain("var(--vscode-input-foreground")
    expect(color(manager, "\\.am-nv-dialog \\.am-prompt-input")).toContain("var(--vscode-input-foreground")
    expect(color(css, "\\.prompt-input-highlight-overlay")).toBe("transparent")
    // Mention and paste text is already painted by the textarea, so the overlay keeps only the chip.
    for (const decoration of ["file-mention", "paste"]) {
      expect(color(css, `\\.prompt-input-${decoration}`)).toBe("transparent")
    }
    // Ghost text exists only in the overlay, so it keeps its own theme color.
    const ghost = color(css, "\\.prompt-input-ghost-text")
    expect(ghost).toContain("var(--vscode-")
    expect(ghost).not.toContain("--vscode-input-foreground")
  })

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

  it("carries the hover underline color in the text-decoration shorthand", () => {
    for (const selector of ["\\.prompt-input-file-mention--file:hover", "\\.prompt-input-paste:hover"]) {
      const body = css.match(new RegExp(`${selector}\\s*{([^}]*)}`))?.[1] ?? ""
      const decl = body.match(/(?:^|;|\s)text-decoration\s*:([^;]*)/)?.[1] ?? ""
      expect(decl).toContain("underline")
      expect(decl).toContain("var(--vscode-")
      expect(body).not.toMatch(/text-decoration-color\s*:[\s\S]*(?:^|;|\s)text-decoration\s*:/)
    }
  })
})
