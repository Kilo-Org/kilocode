// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { normalizeUrls } from "../../../src/kilocode/util/url"

describe("normalizeUrls", () => {
  describe("homograph / IDN conversion", () => {
    test("converts Cyrillic look-alike in hostname to punycode", () => {
      // Cyrillic 'а' (U+0430) is visually identical to Latin 'a'
      const input = "https://\u0430pitest.com/status"
      const result = normalizeUrls(input)
      expect(result).toBe("https://xn--pitest-2nf.com/status")
      expect(result).not.toContain("\u0430")
    })

    test("converts mixed-script hostname to punycode", () => {
      // Mix of Latin and Cyrillic in the same label
      const input = "https://\u0430pitest.com/path"
      expect(normalizeUrls(input)).not.toContain("\u0430")
    })

    test("converts fully unicode TLD to punycode", () => {
      const input = "https://example.\u4e2d\u56fd"
      const result = normalizeUrls(input)
      expect(result).toMatch(/^https:\/\/example\.xn--/)
    })

    test("handles http scheme as well as https", () => {
      const input = "http://\u0430pitest.com/path"
      const result = normalizeUrls(input)
      expect(result).not.toContain("\u0430")
      expect(result).toMatch(/^http:\/\/xn--/)
    })
  })

  describe("plain ASCII URLs are unchanged", () => {
    test("leaves a URL with a path untouched", () => {
      const url = "https://apitest.com/status"
      expect(normalizeUrls(url)).toBe(url)
    })

    test("leaves a URL with path and query string untouched", () => {
      const url = "http://example.com/foo?bar=1&baz=2"
      expect(normalizeUrls(url)).toBe(url)
    })

    test("leaves a localhost URL with port untouched", () => {
      const url = "http://localhost:3000/api"
      expect(normalizeUrls(url)).toBe(url)
    })

    test("leaves a bare origin untouched (no trailing slash added)", () => {
      // Regression: new URL("https://example.com").href === "https://example.com/"
      // The old implementation using href would mutate bare origins by adding "/".
      const url = "https://example.com"
      expect(normalizeUrls(url)).toBe(url)
    })
  })

  describe("trailing sentence punctuation is not consumed into the URL", () => {
    test("period at end of sentence is not consumed (was: adds trailing slash)", () => {
      // "see https://example.com." — the period ends the sentence, not the URL.
      // Old behaviour (bug): returned "see https://example.com./"
      expect(normalizeUrls("see https://example.com.")).toBe("see https://example.com.")
    })

    test("exclamation mark at end of sentence is not consumed", () => {
      expect(normalizeUrls("visit https://example.com!")).toBe("visit https://example.com!")
    })

    test("comma after URL in a list is not consumed", () => {
      expect(normalizeUrls("check https://example.com, then continue")).toBe(
        "check https://example.com, then continue",
      )
    })

    test("closing parenthesis after URL is not consumed", () => {
      expect(normalizeUrls("(see https://example.com)")).toBe("(see https://example.com)")
    })

    test("trailing punctuation after an IDN URL is stripped correctly and punycode applied", () => {
      // Trailing period on a homograph URL: period is sentence punctuation, not part of the URL.
      const input = "see https://\u0430pitest.com."
      const result = normalizeUrls(input)
      expect(result).toBe("see https://xn--pitest-2nf.com.")
      expect(result).not.toContain("\u0430")
    })
  })

  describe("URL embedded in a bash command string", () => {
    test("normalizes the URL portion of a curl command", () => {
      const input = "curl https://\u0430pitest.com/status"
      const result = normalizeUrls(input)
      expect(result).toMatch(/^curl https:\/\/xn--/)
      expect(result).not.toContain("\u0430")
    })

    test("preserves flags and pipe around the URL", () => {
      const input = "curl -sSf https://\u0430pitest.com/status | bash"
      const result = normalizeUrls(input)
      expect(result).toMatch(/^curl -sSf /)
      expect(result).toContain("| bash")
    })

    test("normalizes multiple URLs in a single command", () => {
      const input = "curl https://\u0430pitest.com/a && curl https://\u0430pitest.com/b"
      const result = normalizeUrls(input)
      expect(result.match(/xn--/g)?.length).toBe(2)
      expect(result).not.toContain("\u0430")
    })

    test("leaves a plain-ASCII command entirely unchanged", () => {
      const input = "curl -sSf https://kilo.ai/update.sh | bash"
      expect(normalizeUrls(input)).toBe(input)
    })
  })

  describe("edge cases", () => {
    test("returns empty string unchanged", () => {
      expect(normalizeUrls("")).toBe("")
    })

    test("returns text with no URLs unchanged", () => {
      const text = "just some plain text without links"
      expect(normalizeUrls(text)).toBe(text)
    })

    test("does not alter non-http/https schemes", () => {
      const text = "ftp://example.com and file:///tmp/foo"
      expect(normalizeUrls(text)).toBe(text)
    })

    test("preserves path, query string, and fragment after IDN conversion", () => {
      const input = "https://\u0430pitest.com/path?q=1#anchor"
      const result = normalizeUrls(input)
      expect(result).toMatch(/xn--/)
      expect(result).toContain("/path?q=1#anchor")
    })

    test("preserves a URL that fails to parse verbatim", () => {
      const malformed = "https://[unclosed"
      expect(normalizeUrls(malformed)).toBe(malformed)
    })
  })
})
