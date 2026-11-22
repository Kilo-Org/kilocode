import { describe, expect, it } from "bun:test"
import { displayCommand, skillShellPrompt } from "@/kilocode/skills/display"

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

  it("escapes zero-width format characters as literals", () => {
    // ZWSP (U+200B), BOM (U+FEFF) and the word-joiner range (U+2060..U+2064) occupy no width,
    // so they must show as literals
    const out = displayCommand("echo \u200bok\ufeff\u2060\u2064 rm -rf /")
    expect(out).toBe("echo \\u200bok\\ufeff\\u2060\\u2064 rm -rf /")
    expect(out).not.toMatch(/[\u200b-\u200f\u2060-\u2064\ufeff]/)
  })

  it("escapes width-less format characters from several planes", () => {
    // The tags block (U+E0041), a variation selector (U+FE0F), a variation selector supplement
    // (U+E0100) and a soft hyphen (U+00AD) all render without width, so each shows as a literal
    const out = displayCommand("echo \u{E0041}\uFE0F\u{E0100}\u00AD rm -rf /")
    expect(out).toBe("echo \\u{e0041}\\ufe0f\\u{e0100}\\xad rm -rf /")
    expect(out).not.toContain("\u{E0041}")
    expect(out).not.toContain("\uFE0F")
    expect(out).not.toContain("\u{E0100}")
    expect(out).not.toContain("\u00AD")
  })

  it("escapes the default-ignorable set as literals", () => {
    // The combining grapheme joiner (U+034F), the Mongolian free variation selector (U+180E), a
    // shorthand format control (U+1BCA0) and a musical symbol (U+1D173) all render without width
    const out = displayCommand("echo \u034F\u180E\u{1BCA0}\u{1D173} rm -rf /")
    expect(out).toBe("echo \\u034f\\u180e\\u{1bca0}\\u{1d173} rm -rf /")
    expect(out).not.toContain("\u034F")
    expect(out).not.toContain("\u180E")
    expect(out).not.toContain("\u{1BCA0}")
    expect(out).not.toContain("\u{1D173}")
  })

  it("leaves ordinary commands unchanged", () => {
    expect(displayCommand("git status --short")).toBe("git status --short")
  })
})

describe("skillShellPrompt", () => {
  it("returns undefined when the request is not a skill-shell batch", () => {
    expect(skillShellPrompt(undefined)).toBeUndefined()
    expect(skillShellPrompt({ skillShell: false })).toBeUndefined()
    expect(skillShellPrompt({})).toBeUndefined()
  })

  it("names the skill and returns verbatim, escaped commands", () => {
    const out = skillShellPrompt({ skillShell: true, skill: "git-status", commands: ["git status", "echo \u202ex"] })
    expect(out).toEqual({
      title: 'Run shell commands from skill "git-status"?',
      commands: ["git status", "echo \\u202ex"],
    })
  })

  it("falls back to a generic title and drops non-string commands", () => {
    const out = skillShellPrompt({ skillShell: true, commands: ["ok", 42, null] })
    expect(out).toEqual({ title: "Run these skill commands?", commands: ["ok"] })
  })
})
