import { afterAll, afterEach, beforeEach, describe, it, expect } from "bun:test"
import { Window } from "happy-dom"
import { applyTranscriptHighlights } from "../../webview-ui/src/components/chat/transcript-search-highlight"
import { acronymMatch, searchMatch } from "../../webview-ui/src/utils/search-match"

// ---------------------------------------------------------------------------
// acronymMatch — low-level word-boundary matching
// ---------------------------------------------------------------------------

describe("acronymMatch", () => {
  describe("basic word boundary matching", () => {
    it("matches at word start", () => {
      expect(acronymMatch("fool org", "foo")).toBe(true)
      expect(acronymMatch("the fool", "foo")).toBe(true)
    })

    it("does not match arbitrary substrings", () => {
      expect(acronymMatch("faoboc", "foo")).toBe(false)
      expect(acronymMatch("barfoo", "foo")).toBe(false)
    })

    it("matches prefix of a single word", () => {
      expect(acronymMatch("foobar", "foob")).toBe(true)
    })

    it("matches exact word", () => {
      expect(acronymMatch("test", "test")).toBe(true)
      expect(acronymMatch("testing", "test")).toBe(true)
      expect(acronymMatch("the test", "test")).toBe(true)
    })
  })

  describe("word separators", () => {
    it("recognizes space", () => {
      expect(acronymMatch("hello world", "wor")).toBe(true)
    })

    it("recognizes hyphen", () => {
      expect(acronymMatch("hello-world", "wor")).toBe(true)
    })

    it("recognizes underscore", () => {
      expect(acronymMatch("hello_world", "wor")).toBe(true)
    })

    it("recognizes slash", () => {
      expect(acronymMatch("hello/world", "wor")).toBe(true)
    })

    it("recognizes dot", () => {
      expect(acronymMatch("hello.world", "wor")).toBe(true)
    })

    it("recognizes parentheses", () => {
      expect(acronymMatch("Grok Code Fast 1 (free)", "free")).toBe(true)
    })
  })

  describe("acronym matching", () => {
    it("matches acronyms from word starts", () => {
      expect(acronymMatch("Claude Sonnet", "clso")).toBe(true)
    })

    it("matches partial acronyms", () => {
      expect(acronymMatch("Claude Sonnet 3.5", "cls")).toBe(true)
    })

    it("matches direct and acronym", () => {
      expect(acronymMatch("clso tool", "clso")).toBe(true)
      expect(acronymMatch("Claude Sonnet", "clso")).toBe(true)
    })

    it("does not match non-boundary acronym", () => {
      expect(acronymMatch("aclbso", "clso")).toBe(false)
    })
  })

  describe("camelCase and PascalCase", () => {
    it("recognizes camelCase boundary", () => {
      expect(acronymMatch("gitRebase", "gr")).toBe(true)
    })

    it("matches PascalCase acronyms", () => {
      expect(acronymMatch("NewFileCreation", "nfc")).toBe(true)
    })

    it("splits camelCase at uppercase transitions", () => {
      expect(acronymMatch("parseMarkdownContent", "pmc")).toBe(true)
    })

    it("handles mixed case scenarios", () => {
      expect(acronymMatch("gitRebase", "gitr")).toBe(true)
      expect(acronymMatch("GitRebase", "gitr")).toBe(true)
    })
  })

  describe("backtracking", () => {
    it("matches word that appears later in text", () => {
      expect(acronymMatch("google gemini", "gemini")).toBe(true)
      expect(acronymMatch("gemini pro", "gemini")).toBe(true)
      expect(acronymMatch("google em emini", "gemini")).toBe(true)
    })

    it("matches partial word that appears later", () => {
      expect(acronymMatch("Microsoft Copilot", "copilot")).toBe(true)
      expect(acronymMatch("GitHub Copilot", "copilot")).toBe(true)
    })

    it("still respects word boundaries with backtracking", () => {
      expect(acronymMatch("google gemini", "gemini")).toBe(true)
      expect(acronymMatch("googlegemini", "gemini")).toBe(false)
    })
  })

  describe("edge cases", () => {
    it("handles empty text", () => {
      expect(acronymMatch("", "foo")).toBe(false)
    })

    it("handles empty query", () => {
      expect(acronymMatch("foo", "")).toBe(true)
    })

    it("handles special characters in text", () => {
      expect(acronymMatch("foo-bar", "foob")).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// searchMatch — high-level search with trimming and multi-word support
// ---------------------------------------------------------------------------

describe("searchMatch", () => {
  describe("empty and whitespace queries", () => {
    it("returns true for empty query", () => {
      expect(searchMatch("", "anything")).toBe(true)
    })

    it("returns true for whitespace-only query", () => {
      expect(searchMatch("   ", "anything")).toBe(true)
    })
  })

  describe("case insensitivity", () => {
    it("matches case-insensitively", () => {
      expect(searchMatch("foo", "Foo Bar")).toBe(true)
      expect(searchMatch("foo", "FOO BAZ")).toBe(true)
      expect(searchMatch("FoO", "foo qux")).toBe(true)
    })
  })

  describe("trimming", () => {
    it("trims leading spaces", () => {
      expect(searchMatch(" foo", "foo bar")).toBe(true)
    })

    it("trims trailing spaces", () => {
      expect(searchMatch("foo ", "foo bar")).toBe(true)
    })

    it("trims spaces on both sides", () => {
      expect(searchMatch("  foo  ", "foo bar")).toBe(true)
    })
  })

  describe("multi-word queries", () => {
    it("matches when all words present", () => {
      expect(searchMatch("claude sonnet", "Claude Sonnet 3.5")).toBe(true)
    })

    it("does not match when any word missing", () => {
      expect(searchMatch("claude sonnet", "Claude Opus")).toBe(false)
      expect(searchMatch("claude sonnet", "GPT Sonnet")).toBe(false)
    })
  })

  describe("real-world model search", () => {
    it("finds model with hyphen in query", () => {
      expect(searchMatch("gpt-5", "OpenAI: gpt-5 mini")).toBe(true)
      expect(searchMatch("gpt-5", "OpenAI: gpt-4")).toBe(false)
    })

    it("finds model when hyphen omitted from query", () => {
      expect(searchMatch("gpt5", "OpenAI: gpt-5 mini")).toBe(true)
    })

    it("finds all models with trailing hyphen", () => {
      expect(searchMatch("gpt-", "OpenAI: gpt-5 mini")).toBe(true)
      expect(searchMatch("gpt-", "OpenAI: gpt-4")).toBe(true)
      expect(searchMatch("gpt-", "Anthropic: claude-3")).toBe(false)
    })

    it("matches file paths", () => {
      expect(searchMatch("code", "src/services/code-index/manager.ts")).toBe(true)
    })

    it("matches mode selector options by label+value", () => {
      expect(searchMatch("cod", "Code code Write code")).toBe(true)
    })
  })
})

describe("transcript search highlights", () => {
  const window = new Window()
  const registry = new Map<string, Set<Range>>()
  const saved = {
    document: globalThis.document,
    Text: globalThis.Text,
    NodeFilter: globalThis.NodeFilter,
    CSS: globalThis.CSS,
    Highlight: Reflect.get(globalThis, "Highlight"),
  }

  beforeEach(() => {
    Object.assign(globalThis, {
      document: window.document,
      Text: window.Text,
      NodeFilter: window.NodeFilter,
      CSS: { escape: window.CSS.escape, highlights: registry },
      Highlight: class extends Set<Range> {
        constructor(...ranges: Range[]) {
          super(ranges)
        }
      },
    })
  })
  afterEach(() => Object.assign(globalThis, saved))
  afterAll(() => window.happyDOM.close())

  it("keeps forward and previous matches exact when an earlier board card shrinks", () => {
    const root = window.document.createElement("div")
    root.innerHTML = `<div data-row-key="row">${["a", "b"]
      .map(
        (id) =>
          `<div data-part-id="${id}" data-tool="board_read"><div data-slot="board-messages">${[0, 1, 2, 3]
            .map((index) => `<p id="${id}${index}">Message needle ${id}${index}</p>`)
            .join("")}</div></div>`,
      )
      .join("")}</div>`
    expect(root.textContent.match(/needle/g)).toHaveLength(8)
    const a = root.querySelector("#a3")!
    const b = root.querySelector("#b3")!
    const parents = [a.parentElement!, b.parentElement!]
    const parts = new Map([["row", new Set(["a", "b"])]])
    const select = (part: string, occurrence: number, offset: number) => {
      const range = applyTranscriptHighlights(
        root as unknown as HTMLElement,
        /needle/g,
        { key: "row", occurrence, partId: part, partOccurrence: offset },
        parts,
      )
      expect(range?.startContainer.parentElement?.id).toBe(`${part}${offset}`)
      expect(registry.get("kilo-transcript-search-match-active")?.has(range!)).toBe(true)
      expect(registry.get("kilo-transcript-search-match")?.size).toBe(6)
    }

    b.remove()
    select("a", 3, 3)
    a.remove()
    parents.at(1)!.append(b)
    for (const offset of [0, 1, 2, 3, 2, 1, 0]) select("b", 4 + offset, offset)
    b.remove()
    parents.at(0)!.append(a)
    select("a", 3, 3)
  })

  it("preserves row offsets when active text has no part marker", () => {
    const root = window.document.createElement("div")
    root.innerHTML = '<div data-row-key="row"><p>First needle</p><p id="last">Last needle</p></div>'
    for (const partId of [undefined, "missing"]) {
      const range = applyTranscriptHighlights(
        root as unknown as HTMLElement,
        /needle/g,
        { key: "row", occurrence: 1, partId, partOccurrence: 0 },
        new Map([["row", new Set(partId ? [partId] : [])]]),
      )
      expect(range?.startContainer.parentElement?.id).toBe("last")
      expect(registry.get("kilo-transcript-search-match")?.size).toBe(1)
    }
  })
})
