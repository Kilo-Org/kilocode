import { describe, it, expect } from "bun:test"
import { normalizeLocale, resolveTemplate } from "../../webview-ui/src/context/language-utils"

describe("normalizeLocale", () => {
  it("returns 'en' for English", () => {
    expect(normalizeLocale("en")).toBe("en")
    expect(normalizeLocale("en-US")).toBe("en")
    expect(normalizeLocale("en-GB")).toBe("en")
  })

  it("returns 'zh' for Simplified Chinese", () => {
    expect(normalizeLocale("zh")).toBe("zh")
    expect(normalizeLocale("zh-CN")).toBe("zh")
    expect(normalizeLocale("zh-Hans")).toBe("zh")
  })

  it("returns 'zht' for Traditional Chinese", () => {
    expect(normalizeLocale("zh-Hant")).toBe("zht")
    expect(normalizeLocale("zh-TW")).toBe("zh")
    expect(normalizeLocale("zh-hant-TW")).toBe("zht")
  })

  it("returns 'de' for German", () => {
    expect(normalizeLocale("de")).toBe("de")
    expect(normalizeLocale("de-AT")).toBe("de")
  })

  it("returns 'ko' for Korean", () => {
    expect(normalizeLocale("ko")).toBe("ko")
    expect(normalizeLocale("ko-KR")).toBe("ko")
  })

  it("returns 'no' for Norwegian Bokmål", () => {
    expect(normalizeLocale("nb")).toBe("no")
    expect(normalizeLocale("nb-NO")).toBe("no")
  })

  it("returns 'no' for Norwegian Nynorsk", () => {
    expect(normalizeLocale("nn")).toBe("no")
  })

  it("returns 'br' for Portuguese", () => {
    expect(normalizeLocale("pt")).toBe("br")
    expect(normalizeLocale("pt-BR")).toBe("br")
    expect(normalizeLocale("pt-PT")).toBe("br")
  })

  it("falls back to 'en' for unknown locale", () => {
    expect(normalizeLocale("xx")).toBe("en")
    expect(normalizeLocale("xyz-ZZ")).toBe("en")
  })

  it("is case-insensitive", () => {
    expect(normalizeLocale("EN")).toBe("en")
    expect(normalizeLocale("DE")).toBe("de")
    expect(normalizeLocale("ZH-HANT")).toBe("zht")
  })
})

describe("resolveTemplate", () => {
  it("returns text unchanged when no params", () => {
    expect(resolveTemplate("hello world")).toBe("hello world")
  })

  it("returns text unchanged when params is undefined", () => {
    expect(resolveTemplate("no {{var}} here", undefined)).toBe("no {{var}} here")
  })

  it("interpolates a single variable", () => {
    expect(resolveTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!")
  })

  it("interpolates multiple variables", () => {
    const result = resolveTemplate("{{a}} + {{b}} = {{c}}", { a: "1", b: "2", c: "3" })
    expect(result).toBe("1 + 2 = 3")
  })

  it("replaces missing variable with empty string", () => {
    expect(resolveTemplate("{{missing}}", {})).toBe("")
  })

  it("handles numeric variable values", () => {
    expect(resolveTemplate("count: {{n}}", { n: 42 })).toBe("count: 42")
  })

  it("handles whitespace around key in braces", () => {
    expect(resolveTemplate("{{ name }}", { name: "test" })).toBe("test")
  })

  it("leaves unrelated text intact", () => {
    const result = resolveTemplate("prefix {{x}} suffix", { x: "VALUE" })
    expect(result).toBe("prefix VALUE suffix")
  })
})
