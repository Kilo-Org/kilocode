import { describe, expect, it } from "bun:test"
import { createRequire } from "node:module"

// chromium-bidi pins zod 3, which has no patched release. The root package.json installs
// zod 4 for it and patches/chromium-bidi@0.8.0.patch points its imports at zod 4's
// bundled v3 API (`zod/v3`). If that patch stops applying, these assertions fail.
const req = createRequire(Bun.resolveSync("chromium-bidi/package.json", import.meta.dir))
const parser = req("chromium-bidi/lib/cjs/protocol-parser/protocol-parser.js")

describe("chromium-bidi on zod/v3", () => {
  it("resolves zod 4 for chromium-bidi", () => {
    expect(Number(req("zod/package.json").version.split(".")[0])).toBeGreaterThanOrEqual(4)
  })

  it("parses valid WebDriver BiDi commands", () => {
    const params = parser.BrowsingContext.parseNavigateParams({
      context: "ctx",
      url: "https://example.com",
      wait: "complete",
    })
    expect(params.url).toBe("https://example.com")
    expect(params.wait).toBe("complete")
  })

  it("rejects invalid commands with BiDi errors", () => {
    expect(() => parser.BrowsingContext.parseNavigateParams({ context: 1 })).toThrow(/context/)
  })
})
