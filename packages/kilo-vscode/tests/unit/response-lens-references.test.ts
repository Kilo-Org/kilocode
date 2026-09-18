import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { responseLensReferences } from "../../webview-ui/src/utils/response-lens-references"
import { validExplainBrieflyRequest } from "../../src/shared/response-lens"
import { publicAddress, publicReference, fetchReference } from "../../src/kilo-provider/response-lens-network"

function capture(text: string) {
  return { text, row: { querySelectorAll: () => [] } as unknown as HTMLElement }
}

describe("selected reference discovery", () => {
  test("discovers paths and links without treating the URL filename as another file", () => {
    const refs = responseLensReferences(capture("Read `src/config.ts#L4-L8` and https://example.com/guide.md."))
    expect(refs).toHaveLength(2)
    expect(refs).toContainEqual({ kind: "file", target: "src/config.ts#L4-L8" })
    expect(refs).toContainEqual({ kind: "url", target: "https://example.com/guide.md" })
  })

  test("keeps quoted paths with spaces and Windows line suffixes", () => {
    const refs = responseLensReferences(capture('"C:\\project\\some file.ts:10:3"'))
    expect(refs).toEqual([{ kind: "file", target: "C:\\project\\some file.ts:10:3" }])
  })

  test("raw Markdown links do not cause filename-label lookups", () => {
    expect(responseLensReferences(capture("[README.md](https://example.com/docs)"))).toEqual([
      { kind: "url", target: "https://example.com/docs" },
    ])
  })

  test("returns an over-limit sentinel instead of silently ignoring a third source", () => {
    expect(responseLensReferences(capture("one.md two.txt three.py four.ts"))).toHaveLength(3)
  })

  test("uses only the selected anchor and does not duplicate its code label", () => {
    const window = new Window()
    window.document.body.innerHTML =
      '<div><a href="file:///C:/project/first.ts"><code>first.ts</code></a> <a href="https://unselected.example.com/private.md">private.md</a></div>'
    const row = window.document.querySelector("div")!
    const range = window.document.createRange()
    range.selectNodeContents(row.querySelector("code")!)
    const refs = responseLensReferences({
      text: range.toString(),
      row: row as unknown as HTMLElement,
      range: range as unknown as Range,
    })
    expect(refs).toEqual([{ kind: "file", target: "file:///C:/project/first.ts" }])
    window.happyDOM.abort()
  })

  test("an unsupported selected link cannot become an unrelated local filename", () => {
    const window = new Window()
    window.document.body.innerHTML = '<div><a href="javascript:alert(1)">README.md</a></div>'
    const row = window.document.querySelector("div")!
    const range = window.document.createRange()
    range.selectNodeContents(row.querySelector("a")!)
    expect(
      responseLensReferences({
        text: range.toString(),
        row: row as unknown as HTMLElement,
        range: range as unknown as Range,
      }),
    ).toEqual([{ kind: "url", target: "javascript:alert(1)" }])
    window.happyDOM.abort()
  })

  test("validates reference transport bounds", () => {
    const body = {
      type: "explainBriefly",
      requestId: "r",
      sessionID: "s",
      messageID: "m",
      text: "x",
      level: "simple",
      model: { providerID: "p", modelID: "m" },
      context: [],
    }
    expect(validExplainBrieflyRequest({ ...body, references: [{ kind: "file", target: "x.md" }] })).toBe(true)
    expect(validExplainBrieflyRequest({ ...body, references: [{ kind: "shell", target: "x" }] })).toBe(false)
    expect(validExplainBrieflyRequest({ ...body, references: Array(3).fill({ kind: "file", target: "x.md" }) })).toBe(
      false,
    )
    expect(validExplainBrieflyRequest({ ...body, references: [{ kind: "url", target: "x".repeat(2049) }] })).toBe(false)
  })

  for (const [href, expected] of [
    ["#overview", []],
    ["docs/", [{ kind: "file", target: "docs/" }]],
    ["https://example.com/docs/guide.", [{ kind: "url", target: "https://example.com/docs/guide." }]],
  ] as const) {
    test(`uses the actual anchor target without guessing from its label: ${href}`, () => {
      const window = new Window()
      const row = window.document.createElement("div")
      const link = window.document.createElement("a")
      link.setAttribute("href", href)
      link.textContent = "README.md"
      row.append(link)
      window.document.body.append(row)
      const range = window.document.createRange()
      range.selectNodeContents(link)
      expect(
        responseLensReferences({
          text: range.toString(),
          row: row as unknown as HTMLElement,
          range: range as unknown as Range,
        }),
      ).toEqual(expected)
      window.happyDOM.abort()
    })
  }
})

describe("public document destination policy", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "172.16.0.1",
    "100.64.0.1",
    "198.18.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:8.8.8.8",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])
    test(`blocks non-public or transition address ${address}`, () => expect(publicAddress(address)).toBe(false))
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    test(`allows public unicast ${address}`, () => expect(publicAddress(address)).toBe(true))
  for (const url of [
    "http://example.com/doc",
    "https://user:secret@example.com/doc",
    "https://example.com:8443/doc",
    "https://localhost/doc",
    "https://2130706433/doc",
    "https://0x7f000001/doc",
    "https://[::ffff:127.0.0.1]/doc",
    "https://example.com/doc?token=secret",
    "https://example.com/doc#access_token=secret",
    "https://example.com/%75nsubscribe/id",
    "https://example.com/oauth/callback",
    "file:///etc/passwd",
  ])
    test(`refuses unsafe selected target ${url}`, () => expect(() => publicReference(url)).toThrow())
  test("permits a normal public document and line/page fragment", () => {
    expect(publicReference("https://example.com/guide.pdf#page=2").hash).toBe("#page=2")
  })
  test("rejects localhost before any network operation", async () => {
    await expect(fetchReference("https://127.0.0.1/private", new AbortController().signal)).rejects.toThrow(
      "Private-network",
    )
  })
  test("rejects signed Google Cloud capability URLs before DNS", async () => {
    const url = "https://storage.googleapis.com/bucket/private.pdf?X-Goog-Credential=FAKE&X-Goog-Signature=NOT_REAL"
    expect(() => publicReference(url)).toThrow()
    await expect(fetchReference(url, new AbortController().signal)).rejects.toThrow()
  })
})
