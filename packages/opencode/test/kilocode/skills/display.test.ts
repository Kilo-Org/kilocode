import { describe, expect, it } from "bun:test"
import { displayCommand } from "@/kilocode/skills/display"

describe("displayCommand", () => {
  it("escapes control characters so a command cannot repaint the prompt", () => {
    // CR/ESC would otherwise let the visible text differ from what executes
    const out = displayCommand("echo ok\r\x1b[2Krm -rf /\nnext")
    expect(out).toBe("echo ok\\r\\x1b[2Krm -rf /\\nnext")
    expect(out).not.toMatch(/[\u0000-\u001f]/)
  })

  it("escapes bidi/format controls so Trojan-Source reordering can't hide intent", () => {
    // RLO (U+202E) + PDI (U+2069) would visually reorder the command in the prompt
    const out = displayCommand("echo \u202esafe\u2069 rm -rf /")
    expect(out).toBe("echo \\u202esafe\\u2069 rm -rf /")
    expect(out).not.toMatch(/[\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/)
  })

  it("leaves ordinary commands unchanged", () => {
    expect(displayCommand("git status --short")).toBe("git status --short")
  })
})
