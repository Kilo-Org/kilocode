import { describe, expect, test } from "bun:test"
import { hashArguments, rememberHash, rememberStep, resetSteps, takeHash, takeStep } from "../../src/browser/steps"

describe("tool argument hashing", () => {
  // Vectors computed with the extension's own `hashBrowserToolArguments` (Kilo-Org/cloud browser-agent-checks.ts),
  // so a CLI that drifts from the browser's canonical form fails here instead of losing a download.
  test("matches the extension's canonical hash", () => {
    expect(hashArguments({ target: "e1" })).toBe("b1391036:15")
    expect(hashArguments({ target: "e1", text: "a" })).toBe("9343961e:26")
    expect(hashArguments({ text: "a", target: "e1" })).toBe("9343961e:26")
    expect(hashArguments({ paths: ["/tmp/a.png"] })).toBe("1e4852ce:24")
    expect(hashArguments({ nested: { b: 1, a: [1, 2] } })).toBe("5fff9b3f:28")
    expect(hashArguments({})).toBe("5465b825:2")
  })

  // The vectors the extension agent publishes for its own `hashBrowserToolArguments` (/tmp/browser-bridge/
  // hash-vectors.json), so a drift on either side shows up as a failing test rather than a lost download.
  test("matches the extension's published vectors", () => {
    expect(hashArguments({ scale: "css", url: "https://example.com/report.txt" })).toBe("19ea8d50:54")
    expect(
      hashArguments({
        options: { button: "left", doubleClick: true },
        target: "e12",
        nested: { a: [{ b: 2, a: 1 }], z: 1 },
      }),
    ).toBe("ea504bc5:100")
    expect(
      hashArguments({
        nested: { z: 1, a: [{ a: 1, b: 2 }] },
        target: "e12",
        options: { doubleClick: true, button: "left" },
      }),
    ).toBe("ea504bc5:100")
  })

  test("a token remembered for a hash is spent once, by that hash only", () => {
    resetSteps()
    const hash = hashArguments({ target: "e1" })
    rememberHash("ses_a", "browser_click", hash, "tok")
    expect(takeStep("ses_a", "browser_click", { target: "e1" })).toBe("tok")
    expect(takeStep("ses_a", "browser_click", { target: "e1" })).toBeUndefined()
    rememberStep("ses_a", "browser_click", { target: "e1" }, "tok")
    expect(takeHash("ses_a", "browser_click", hashArguments({ target: "e2" }))).toBeUndefined()
    expect(takeStep("ses_a", "browser_click", { target: "e1" })).toBe("tok")
  })
})
