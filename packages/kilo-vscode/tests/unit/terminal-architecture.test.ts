import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const src = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf-8")

describe("terminal context architecture", () => {
  it("keeps VS Code terminal command capture in the terminal service", () => {
    const helper = src("src/services/terminal/context.ts")
    const provider = src("src/KiloProvider.ts")
    const actions = src("src/services/code-actions/register-terminal-actions.ts")

    expect(helper).toContain("workbench.action.terminal.selectAll")
    expect(provider).not.toContain("workbench.action.terminal.selectAll")
    expect(actions).not.toContain("workbench.action.terminal.selectAll")
  })

  it("keeps webview terminal attachment logic outside PromptInput", () => {
    const prompt = src("webview-ui/src/components/chat/PromptInput.tsx")
    const hook = src("webview-ui/src/hooks/useTerminalContext.ts")
    const util = src("webview-ui/src/hooks/terminal-context-utils.ts")

    expect(prompt).toContain("useTerminalContext")
    expect(prompt).not.toContain("requestTerminalContext")
    expect(prompt).not.toContain("data:text/plain")
    expect(hook).toContain("requestTerminalContext")
    expect(util).toContain("data:text/plain")
  })

  it("keeps terminal output limits in the shared truncation helper", () => {
    const helper = src("src/services/terminal/truncate.ts")
    const provider = src("src/KiloProvider.ts")
    const prompt = src("webview-ui/src/components/chat/PromptInput.tsx")

    expect(helper).toContain("TERMINAL_OUTPUT_LINE_LIMIT = 500")
    expect(helper).toContain("TERMINAL_OUTPUT_CHARACTER_LIMIT = 50_000")
    expect(provider).not.toContain("TERMINAL_OUTPUT_LINE_LIMIT")
    expect(prompt).not.toContain("TERMINAL_OUTPUT_LINE_LIMIT")
  })
})
