import { describe, expect, it } from "bun:test"
import { displayCommand } from "@/kilocode/skills/display"

describe("displayCommand", () => {
  it("escapes control characters so a command cannot repaint the prompt", () => {
    // CR/ESC would otherwise let the visible text differ from what executes
    const out = displayCommand("echo ok\r\x1b[2Krm -rf /\nnext")
    expect(out).toBe("echo ok\\r\\x1b[2Krm -rf /\\nnext")
    expect(out).not.toMatch(/[\u0000-\u001f]/)
  })

  it("leaves ordinary commands unchanged", () => {
    expect(displayCommand("git status --short")).toBe("git status --short")
  })
})
