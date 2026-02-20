import { describe, it, expect } from "bun:test"
import { parseAutocompleteResponse } from "../../src/services/autocomplete/classic-auto-complete/hole-filler-utils"

describe("parseAutocompleteResponse", () => {
  const prefix = "function foo() {\n  "
  const suffix = "\n}"

  it("extracts content between COMPLETION tags", () => {
    const result = parseAutocompleteResponse("<COMPLETION>return 42;</COMPLETION>", prefix, suffix)
    expect(result.text).toBe("return 42;")
    expect(result.prefix).toBe(prefix)
    expect(result.suffix).toBe(suffix)
  })

  it("returns empty text when no COMPLETION tags", () => {
    const result = parseAutocompleteResponse("return 42;", prefix, suffix)
    expect(result.text).toBe("")
  })

  it("handles multiline completion content", () => {
    const result = parseAutocompleteResponse("<COMPLETION>const x = 1;\nreturn x;</COMPLETION>", prefix, suffix)
    expect(result.text).toBe("const x = 1;\nreturn x;")
  })

  it("handles case-insensitive tags", () => {
    const result = parseAutocompleteResponse("<completion>return x;</completion>", prefix, suffix)
    expect(result.text).toBe("return x;")
  })

  it("handles empty COMPLETION tags", () => {
    const result = parseAutocompleteResponse("<COMPLETION></COMPLETION>", prefix, suffix)
    expect(result.text).toBe("")
  })

  it("handles whitespace-only content in tags", () => {
    const result = parseAutocompleteResponse("<COMPLETION>  </COMPLETION>", prefix, suffix)
    expect(result.text).toBe("  ")
  })

  it("handles response with prose before and after tags", () => {
    const response = "Here is your completion:\n<COMPLETION>return value;</COMPLETION>\nHope that helps!"
    const result = parseAutocompleteResponse(response, prefix, suffix)
    expect(result.text).toBe("return value;")
  })

  it("removes accidentally captured tag remnants", () => {
    const result = parseAutocompleteResponse("<COMPLETION><COMPLETION>inner</COMPLETION></COMPLETION>", prefix, suffix)
    expect(result.text).toBe("inner")
  })

  it("returns empty text for empty response", () => {
    const result = parseAutocompleteResponse("", prefix, suffix)
    expect(result.text).toBe("")
  })

  it("preserves prefix and suffix in result", () => {
    const result = parseAutocompleteResponse("<COMPLETION>x</COMPLETION>", "pre", "suf")
    expect(result.prefix).toBe("pre")
    expect(result.suffix).toBe("suf")
  })
})
