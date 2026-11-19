import { describe, expect, test } from "bun:test"
import { hashArguments, rememberHash, rememberStep, resetSteps, takeHash, takeStep } from "../../src/browser/steps"

describe("tool argument hashing", () => {
  // The extension's FINAL cross-implementation vectors, pinned verbatim from /tmp/browser-bridge/hash-vectors.json:
  // both spellings of the same call hash alike, so a drift on either side fails here instead of losing a download.
  test("matches the extension's published vectors", () => {
    expect(hashArguments({ scale: "css", url: "https://example.com/report.txt" })).toBe("19ea8d50:54")
    expect(
      hashArguments({
        nested: { items: [{ count: 2, rank: 1 }], zeta: 1 },
        options: { button: "left", doubleClick: true },
        target: "e12",
      }),
    ).toBe("a243193a:114")
    expect(
      hashArguments({
        options: { button: "left", doubleClick: true },
        target: "e12",
        nested: { items: [{ count: 2, rank: 1 }], zeta: 1 },
      }),
    ).toBe("a243193a:114")
  })

  // CLI-only coverage: values computed with the extension's implementation for shapes the published set does not
  // exercise (arrays of primitives, a nested object, the empty call).
  test("also matches the extension's implementation on further shapes (CLI-only)", () => {
    expect(hashArguments({ target: "e1" })).toBe("b1391036:15")
    expect(hashArguments({ target: "e1", text: "a" })).toBe("9343961e:26")
    expect(hashArguments({ text: "a", target: "e1" })).toBe("9343961e:26")
    expect(hashArguments({ paths: ["/tmp/a.png"] })).toBe("1e4852ce:24")
    expect(hashArguments({ nested: { b: 1, a: [1, 2] } })).toBe("5fff9b3f:28")
    expect(hashArguments({})).toBe("5465b825:2")
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
