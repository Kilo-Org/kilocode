import { describe, it, expect } from "bun:test"
import { createPrompt } from "../../src/services/code-actions/support-prompt"

const base = {
  filePath: "src/foo.ts",
  startLine: "10",
  endLine: "20",
  selectedText: "const x = 1",
  userInput: "",
}

describe("createPrompt", () => {
  describe("EXPLAIN", () => {
    it("includes file path and line range", () => {
      const result = createPrompt("EXPLAIN", base)
      expect(result).toContain("src/foo.ts:10-20")
    })

    it("includes selected text in code fence", () => {
      const result = createPrompt("EXPLAIN", base)
      expect(result).toContain("```\nconst x = 1\n```")
    })

    it("includes userInput when provided", () => {
      const result = createPrompt("EXPLAIN", { ...base, userInput: "explain this" })
      expect(result).toContain("explain this")
    })

    it("does not include diagnostics section", () => {
      const result = createPrompt("EXPLAIN", base)
      expect(result).not.toContain("Current problems detected")
    })
  })

  describe("FIX", () => {
    it("includes file path and line range", () => {
      const result = createPrompt("FIX", base)
      expect(result).toContain("src/foo.ts:10-20")
    })

    it("includes no diagnostics section when diagnostics is empty", () => {
      const result = createPrompt("FIX", { ...base, diagnostics: [] })
      expect(result).not.toContain("Current problems detected")
    })

    it("includes diagnostics section when diagnostics provided", () => {
      const diag = [{ source: "ts", message: "Type error", code: 2322 }]
      const result = createPrompt("FIX", { ...base, diagnostics: diag })
      expect(result).toContain("Current problems detected")
      expect(result).toContain("[ts] Type error (2322)")
    })

    it("formats diagnostic without code", () => {
      const diag = [{ source: "eslint", message: "no-unused-vars" }]
      const result = createPrompt("FIX", { ...base, diagnostics: diag })
      expect(result).toContain("[eslint] no-unused-vars")
      expect(result).not.toContain("undefined")
    })

    it("formats diagnostic without source using 'Error' fallback", () => {
      const diag = [{ message: "something went wrong" }]
      const result = createPrompt("FIX", { ...base, diagnostics: diag })
      expect(result).toContain("[Error] something went wrong")
    })

    it("includes multiple diagnostics", () => {
      const diag = [
        { source: "ts", message: "Err1", code: 1 },
        { source: "ts", message: "Err2", code: 2 },
      ]
      const result = createPrompt("FIX", { ...base, diagnostics: diag })
      expect(result).toContain("[ts] Err1 (1)")
      expect(result).toContain("[ts] Err2 (2)")
    })
  })

  describe("IMPROVE", () => {
    it("includes file path and line range", () => {
      const result = createPrompt("IMPROVE", base)
      expect(result).toContain("src/foo.ts:10-20")
    })

    it("includes selected text in code fence", () => {
      const result = createPrompt("IMPROVE", base)
      expect(result).toContain("```\nconst x = 1\n```")
    })

    it("does not render diagnosticText placeholder", () => {
      const result = createPrompt("IMPROVE", base)
      expect(result).not.toContain("${diagnosticText}")
    })
  })

  describe("ADD_TO_CONTEXT", () => {
    it("produces compact file reference with code fence", () => {
      const result = createPrompt("ADD_TO_CONTEXT", base)
      expect(result).toContain("src/foo.ts:10-20")
      expect(result).toContain("```\nconst x = 1\n```")
    })

    it("does not include explanatory prose", () => {
      const result = createPrompt("ADD_TO_CONTEXT", base)
      expect(result).not.toContain("Please")
    })
  })

  describe("TERMINAL_ADD_TO_CONTEXT", () => {
    it("includes terminalContent in code fence", () => {
      const result = createPrompt("TERMINAL_ADD_TO_CONTEXT", {
        userInput: "",
        terminalContent: "npm install",
      })
      expect(result).toContain("```\nnpm install\n```")
    })

    it("includes userInput when provided", () => {
      const result = createPrompt("TERMINAL_ADD_TO_CONTEXT", {
        userInput: "context here",
        terminalContent: "ls",
      })
      expect(result).toContain("context here")
    })

    it("renders empty string for missing terminalContent", () => {
      const result = createPrompt("TERMINAL_ADD_TO_CONTEXT", { userInput: "" })
      expect(result).toContain("```\n\n```")
    })
  })

  describe("TERMINAL_FIX", () => {
    it("includes terminalContent in code fence", () => {
      const result = createPrompt("TERMINAL_FIX", {
        userInput: "",
        terminalContent: "gti status",
      })
      expect(result).toContain("```\ngti status\n```")
    })

    it("asks to fix the command", () => {
      const result = createPrompt("TERMINAL_FIX", { userInput: "", terminalContent: "" })
      expect(result).toContain("Fix this terminal command")
    })
  })

  describe("TERMINAL_EXPLAIN", () => {
    it("includes terminalContent in code fence", () => {
      const result = createPrompt("TERMINAL_EXPLAIN", {
        userInput: "",
        terminalContent: "grep -r foo .",
      })
      expect(result).toContain("```\ngrep -r foo .\n```")
    })

    it("asks to explain the command", () => {
      const result = createPrompt("TERMINAL_EXPLAIN", { userInput: "", terminalContent: "" })
      expect(result).toContain("Explain this terminal command")
    })
  })

  describe("missing params", () => {
    it("renders empty string for unknown template variable", () => {
      const result = createPrompt("ADD_TO_CONTEXT", {
        filePath: "f.ts",
        startLine: "1",
        endLine: "2",
      })
      expect(result).not.toContain("${selectedText}")
      expect(result).toContain("```\n\n```")
    })

    it("does not include literal placeholder text", () => {
      const result = createPrompt("EXPLAIN", {
        filePath: "x.ts",
        startLine: "1",
        endLine: "1",
        selectedText: "code",
        userInput: "",
      })
      expect(result).not.toMatch(/\$\{[a-zA-Z]+\}/)
    })
  })
})
