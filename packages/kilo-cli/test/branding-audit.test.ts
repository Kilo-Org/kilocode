import { describe, expect, test } from "bun:test"
import { candidates, unresolved } from "../src/branding-audit"

describe("branding audit", () => {
  test("reports only the new nodes whose own transformed text still has branding", () => {
    const base = 'const old = "OpenCode was here"\n'
    const current = `${base}const view = <box title="OpenCode settings">OpenCode is ready</box>\nconst text = \`Welcome to OpenCode\`\n`
    const transformed = current.replace("OpenCode settings", "Kilo settings")
    expect(unresolved("packages/tui/src/view.tsx", base, current, transformed)).toEqual([
      { text: "OpenCode is ready", line: 2 },
      { text: "Welcome to OpenCode", line: 3 },
    ])
  })

  test("reports a different brand kind left by a partial transformation", () => {
    const current = "const view = <text>OpenCode reads opencode.jsonc</text>"
    const transformed = "const view = <text>Kilo reads opencode.jsonc</text>"
    expect(unresolved("view.tsx", "", current, transformed)).toEqual([
      { text: "OpenCode reads opencode.jsonc", line: 1 },
    ])
  })

  test("does not confuse unrelated surviving branding with a transformed node", () => {
    const current = 'const one = <text>OpenCode</text>\nconst two = "OpenCode hidden"'
    const transformed = current.replace(">OpenCode<", ">Kilo<")
    expect(unresolved("view.tsx", "", current, transformed)).toEqual([{ text: "OpenCode hidden", line: 2 }])
  })

  test("reports a structurally unmatched node rather than assuming success", () => {
    const current = "const one = <text>OpenCode</text>"
    const transformed = "const extra = 1\nconst one = <text>Kilo</text>"
    expect(unresolved("view.tsx", "", current, transformed)).toEqual([{ text: "OpenCode", line: 1 }])
  })

  test("ignores technical imports, type strings, URLs and provider names", () => {
    const source = `import x from "@opencode/core"
export { x } from "@opencode/client"
type T = "OpenCode"
const url = "https://opencode.ai"
const provider = "OpenCode Go"
const console = "OpenCode Console"
const zen = "OpenCode Zen"
const label = "OpenCode Go works with OpenCode"
`
    expect(candidates("view.ts", source)).toEqual([{ text: "OpenCode Go works with OpenCode", line: 8 }])
  })

  test("counts duplicate candidates without reporting pre-existing text", () => {
    const base = 'const a = "OpenCode"'
    const current = `${base}\nconst b = "OpenCode"`
    expect(unresolved("view.ts", base, current, current)).toEqual([{ text: "OpenCode", line: 2 }])
    expect(unresolved("view.ts", base, current, current.replaceAll("OpenCode", "Kilo"))).toEqual([])
  })

  test("identifies the new duplicate when it precedes an existing candidate", () => {
    const base = 'const old = "OpenCode"'
    const current = 'const added = "OpenCode"\nconst old = "OpenCode"'
    expect(unresolved("view.ts", base, current, current)).toEqual([{ text: "OpenCode", line: 1 }])
  })

  test("reports duplicate baseline nodes when their positions are ambiguous", () => {
    const base = 'console.log("OpenCode")'
    const current = `${base}\nconsole.log("OpenCode")`
    expect(unresolved("view.ts", base, current, current)).toEqual([
      { text: "OpenCode", line: 1 },
      { text: "OpenCode", line: 2 },
    ])
  })

  test("reports identical text moved to a different named context", () => {
    expect(
      unresolved("view.ts", 'const old = "OpenCode"', 'const next = "OpenCode"', 'const next = "OpenCode"'),
    ).toEqual([{ text: "OpenCode", line: 1 }])
  })

  test("reports a new encoding of previously branded text", () => {
    const base = "const view = <text>OpenCode</text>"
    const current = "const view = <text>&#79;penCode</text>"
    expect(unresolved("view.tsx", base, current, current)).toEqual([{ text: "OpenCode", line: 1 }])
  })

  test("reports a partially transformed literal", () => {
    expect(
      unresolved("view.ts", "", 'const title = "OpenCode and OpenCode"', 'const title = "Kilo and OpenCode"'),
    ).toEqual([{ text: "OpenCode and OpenCode", line: 1 }])
  })

  test("reports changed embedded asset lines", () => {
    expect(
      unresolved(
        "page.html",
        "<title>OpenCode</title>",
        "<title>Welcome to OpenCode</title>",
        "<title>Welcome to OpenCode</title>",
      ),
    ).toEqual([{ text: "<title>Welcome to OpenCode</title>", line: 1 }])
  })

  test("reports the physical line for decoded JSX and escaped strings", () => {
    const source = "const view = <box>first &#10; on line one\n  &#79;penCode\n</box>"
    expect(candidates("view.tsx", source)).toEqual([{ text: "first \n on line one\n  OpenCode", line: 2 }])
    expect(candidates("view.ts", 'const text = "first\\nOpenCode"')[0]?.line).toBe(1)
  })

  test("detects cooked Unicode templates even when the source is escaped", () => {
    const source = "const text = `\\u004fpenCode reads \\u006fpencode.jsonc`"
    expect(candidates("view.ts", source)).toEqual([{ text: "OpenCode reads opencode.jsonc", line: 1 }])
    expect(unresolved("view.ts", "", source, source)).toEqual([{ text: "OpenCode reads opencode.jsonc", line: 1 }])
  })

  test("distinguishes terminal output from unrelated write operations", () => {
    const source = 'cache.write("opencode")\nprocess.stdout.write("opencode")\nconsole.log("opencode")'
    expect(candidates("view.ts", source)).toEqual([
      { text: "opencode", line: 2 },
      { text: "opencode", line: 3 },
    ])
  })

  test("detects commands and domains in display contexts without flagging bare identifiers", () => {
    const source = `const internal = "opencode"
const url = "https://opencode.ai"
const name = "opencode_internal"
const view = <box title="opencode">opencode.ai</box>
console.log("opencode --version")
console.log("opencode")
const config = "opencode.jsonc"
const command = <text>opencode</text>
const domain = "opencode.ai"
`
    expect(candidates("view.tsx", source).map((item) => [item.text, item.line])).toEqual([
      ["opencode", 4],
      ["opencode.ai", 4],
      ["opencode --version", 5],
      ["opencode", 6],
      ["opencode.jsonc", 7],
      ["opencode", 8],
      ["opencode.ai", 9],
    ])
  })
})
