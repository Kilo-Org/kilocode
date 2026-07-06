import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const path = join(__dirname, "..", "..", "webview-ui", "src", "components", "chat", "PromptInput.tsx")
const src = readFileSync(path, "utf8")

describe("PromptInput bidirectional text support", () => {
  it("lets the textarea and visible overlay resolve text direction automatically", () => {
    const overlay = src.match(/<div class="prompt-input-highlight-overlay"[\s\S]*?>/)?.[0]
    const input = src.match(/<textarea[\s\S]*?\n\s*\/>/)?.[0]

    expect(overlay).toContain('dir="auto"')
    expect(input).toContain('class="prompt-input"')
    expect(input).toContain('dir="auto"')
  })
})
