import { describe, expect, test } from "bun:test"
import * as Frames from "@/kilocode/browser/frames"

const snapshot = `### Page
- Page URL: https://shop.example.com/checkout
- Page Title: Checkout

### Snapshot
\`\`\`yaml
- generic [ref=e1]:
  - heading "Checkout" [level=1] [ref=e2]
  - textbox "Email" [ref=e3]
  - iframe [ref=e5]:
    - generic [ref=f2e1]:
      - text: CARD-MARKER-9f3a
      - button "Pay 42.00" [ref=f2e2]
  - iframe [ref=e9]:
    - generic [ref=f3e1]:
      - text: local widget
\`\`\`
`

const granted = (origin: string) => origin === "http://localhost:4001"

const origins = new Map([
  ["e5", "https://pay.example.net"],
  ["e9", "http://localhost:4001"],
])

describe("snapshot frame scoping", () => {
  test("an ungranted frame keeps its node and loses its subtree", () => {
    const result = Frames.snapshot(snapshot, origins, granted)
    expect(result).toContain("- iframe [ref=e5] [origin withheld: https://pay.example.net]")
    expect(result).not.toContain("CARD-MARKER-9f3a")
    expect(result).not.toContain('button "Pay 42.00"')
  })

  test("a granted frame keeps its content", () => {
    const result = Frames.snapshot(snapshot, origins, granted)
    expect(result).toContain("- iframe [ref=e9]:")
    expect(result).toContain("- text: local widget")
  })

  test("the page and its own content are untouched", () => {
    const result = Frames.snapshot(snapshot, origins, granted)
    expect(result).toContain('- Page URL: https://shop.example.com/checkout')
    expect(result).toContain('- heading "Checkout" [level=1] [ref=e2]')
    expect(result).toContain('- textbox "Email" [ref=e3]')
  })

  test("a frame nested inside a withheld frame disappears with it", () => {
    const nested = `### Snapshot
\`\`\`yaml
- iframe [ref=e1]:
  - generic [ref=f2e1]:
    - iframe [ref=f2e7]:
      - text: DEEP-MARKER
\`\`\``
    const result = Frames.snapshot(
      nested,
      new Map([
        ["e1", "https://a.example"],
        ["f2e7", "https://b.example"],
      ]),
      () => false,
    )
    expect(result).toBe(`### Snapshot
\`\`\`yaml
- iframe [ref=e1] [origin withheld: https://a.example]
\`\`\``)
    expect(result).not.toContain("DEEP-MARKER")
  })

  test("when every frame is granted the text is byte-identical", () => {
    expect(Frames.snapshot(snapshot, origins, () => true)).toBe(snapshot)
  })

  test("an iframe with an unresolved ref is left alone", () => {
    const result = Frames.snapshot(snapshot, new Map([["e9", "http://localhost:4001"]]), granted)
    expect(result).toContain("- iframe [ref=e5]:")
    expect(result).toContain("CARD-MARKER-9f3a")
  })

  test("iframe refs are listed in document order", () => {
    expect(Frames.iframes(snapshot)).toEqual([
      { ref: "e5", indent: 2 },
      { ref: "e9", indent: 2 },
    ])
  })
})

describe("console and network filtering", () => {
  test("console lines logged by a withheld frame are dropped", () => {
    const text = [
      "Total messages: 3 (Errors: 1, Warnings: 0)",
      "",
      "[LOG] hello @ https://shop.example.com/app.js:12",
      "[ERROR] card declined @ https://pay.example.net/checkout.js:8",
      "[LOG] local @ http://localhost:4001/widget.js:1",
    ].join("\n")
    const result = Frames.consoleMessages(text, new Set(["https://pay.example.net"]))
    expect(result).toContain("[LOG] hello @ https://shop.example.com/app.js:12")
    expect(result).not.toContain("card declined")
    expect(result).toContain("local @ http://localhost:4001/widget.js:1")
  })

  test("requests to a withheld origin are dropped from the numbered list", () => {
    const text = [
      "1. [GET] https://shop.example.com/checkout => [200] OK",
      "2. [POST] https://pay.example.net/api/charge => [402] Payment Required",
    ].join("\n")
    const result = Frames.networkRequests(text, new Set(["https://pay.example.net"]))
    expect(result).toContain("1. [GET] https://shop.example.com/checkout => [200] OK")
    expect(result).not.toContain("api/charge")
  })
})
