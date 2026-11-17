import { describe, expect, test } from "bun:test"
import * as Frames from "../../src/browser/frames"

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
    expect(result).toContain("- Page URL: https://shop.example.com/checkout")
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

  test("an iframe whose ref does not resolve is withheld, not shown", () => {
    const result = Frames.snapshot(snapshot, new Map([["e9", "http://localhost:4001"]]), granted)
    expect(result).toContain("- iframe [ref=e5] [origin withheld]")
    expect(result).not.toContain("CARD-MARKER-9f3a")
    expect(result).toContain("- iframe [ref=e9]:")
  })

  test("an iframe node without a ref is withheld with its subtree", () => {
    const text = `### Snapshot
\`\`\`yaml
- generic [ref=e1]:
  - iframe:
    - text: NO-REF-MARKER
\`\`\``
    const result = Frames.snapshot(text, new Map(), granted)
    expect(result).toContain("- iframe [origin withheld]")
    expect(result).not.toContain("NO-REF-MARKER")
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

describe("opaque withheld frames", () => {
  test("console lines with no origin are dropped while an opaque frame is withheld", () => {
    const text = [
      "Total messages: 2 (Errors: 1, Warnings: 0)",
      "[LOG] page @ https://shop.example.com/app.js:1",
      "[ERROR] hidden @ data:text/html,1:3",
    ].join("\n")
    expect(Frames.consoleMessages(text, new Set(), true)).not.toContain("hidden")
    expect(Frames.consoleMessages(text, new Set(), true)).toContain("page @ https://shop.example.com/app.js:1")
  })

  test("the request list drops unattributable lines while an opaque frame is withheld", () => {
    const text = ["1. [GET] https://shop.example.com/a => [200] OK", "2. [GET] blob:bundle => [200] OK"].join("\n")
    const scoped = Frames.scope({
      tool: "browser_network_requests",
      text,
      withholding: true,
      withheld: new Set(),
      opaque: true,
      granted: () => true,
    })
    expect(scoped.text).toContain("https://shop.example.com/a")
    expect(scoped.text).not.toContain("blob:bundle")
  })
})

describe("scoping a tool result", () => {
  const withheld = new Set(["https://pay.example.net"])

  test("request details are refused while any frame is withheld", () => {
    // A part (headers, a body) carries no URL, so the backend cannot attribute it to a granted frame.
    const result = Frames.scope({
      tool: "browser_network_request",
      text: "authorization: Bearer CARD-MARKER",
      withholding: true,
      withheld,
      granted: () => true,
    })
    expect(result.refused).toBe(true)
    expect(result.text).not.toContain("CARD-MARKER")
    expect(result.text).toContain("unavailable")
  })

  test("request details pass through when nothing is withheld", () => {
    const text = "#1 [GET] https://shop.example.com/checkout"
    const result = Frames.scope({
      tool: "browser_network_request",
      text,
      withholding: false,
      withheld: new Set(),
      granted: () => true,
    })
    expect(result.refused).toBe(false)
    expect(result.text).toBe(text)
  })

  test("the request list is filtered, the console is filtered, the snapshot is masked", () => {
    const result = Frames.scope({
      tool: "browser_network_requests",
      text: [
        "1. [GET] https://shop.example.com/checkout => [200] OK",
        "2. [POST] https://pay.example.net/api/charge => [402] Payment Required",
      ].join("\n"),
      withholding: true,
      withheld,
      granted: () => true,
    })
    expect(result.refused).toBe(false)
    expect(result.text).not.toContain("api/charge")

    const snapshotResult = Frames.scope({
      tool: "browser_snapshot",
      text: snapshot,
      withholding: true,
      withheld,
      origins,
      granted,
    })
    expect(snapshotResult.text).toContain("[origin withheld: https://pay.example.net]")
    expect(snapshotResult.text).not.toContain("CARD-MARKER-9f3a")
  })
})
