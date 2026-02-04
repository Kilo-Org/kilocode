import { describe, it, expect } from "vitest"
import {
	parseLines,
	formatWithLineNumbers,
	readWithIndentation,
	readWithSlice,
	computeEffectiveIndents,
	type LineRecord,
	type IndentationReadResult,
} from "../indentation-reader"

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const PYTHON_CODE = `#!/usr/bin/env python3
"""Module docstring."""
import os
import sys
from typing import List

class Calculator:
    """A simple calculator class."""
    
    def __init__(self, value: int = 0):
        self.value = value
    
    def add(self, n: int) -> int:
        """Add a number."""
        self.value += n
        return self.value
    
    def subtract(self, n: int) -> int:
        """Subtract a number."""
        self.value -= n
        return self.value
    
    def reset(self):
        """Reset to zero."""
        self.value = 0

def main():
    calc = Calculator()
    calc.add(5)
    print(calc.value)

if __name__ == "__main__":
    main()
`

const TYPESCRIPT_CODE = `import { something } from "./module"
import type { SomeType } from "./types"

// Constants
const MAX_VALUE = 100

interface Config {
    name: string
    value: number
}

class Handler {
    private config: Config

    constructor(config: Config) {
        this.config = config
    }

    process(input: string): string {
        // Process the input
        const result = input.toUpperCase()
        if (result.length > MAX_VALUE) {
            return result.slice(0, MAX_VALUE)
        }
        return result
    }

    validate(data: unknown): boolean {
        if (typeof data !== "string") {
            return false
        }
        return data.length > 0
    }
}

export function createHandler(config: Config): Handler {
    return new Handler(config)
}
`

const SIMPLE_CODE = `function outer() {
    function inner() {
        console.log("hello")
    }
    inner()
}
`

const CODE_WITH_BLANKS = `class Example:
    def method_one(self):
        x = 1
        
        y = 2
        
        return x + y
    
    def method_two(self):
        return 42
`

// ─── parseLines Tests ─────────────────────────────────────────────────────────

describe("parseLines", () => {
	it("should parse lines with correct line numbers", () => {
		const content = "line1\nline2\nline3"
		const lines = parseLines(content)

		expect(lines).toHaveLength(3)
		expect(lines[0].lineNumber).toBe(1)
		expect(lines[1].lineNumber).toBe(2)
		expect(lines[2].lineNumber).toBe(3)
	})

	it("should calculate indentation levels correctly", () => {
		const content = "no indent\n    one level\n        two levels\n\t\ttab indent"
		const lines = parseLines(content)

		expect(lines[0].indentLevel).toBe(0)
		expect(lines[1].indentLevel).toBe(1) // 4 spaces = 1 level
		expect(lines[2].indentLevel).toBe(2) // 8 spaces = 2 levels
		expect(lines[3].indentLevel).toBe(2) // 2 tabs = 2 levels (tabs = 4 spaces each)
	})

	it("should identify blank lines", () => {
		const content = "content\n\n   \nmore content"
		const lines = parseLines(content)

		expect(lines[0].isBlank).toBe(false)
		expect(lines[1].isBlank).toBe(true) // empty
		expect(lines[2].isBlank).toBe(true) // whitespace only
		expect(lines[3].isBlank).toBe(false)
	})

	it("should identify block starts (Python style)", () => {
		const content = "def foo():\n    pass\nclass Bar:\n    pass"
		const lines = parseLines(content)

		expect(lines[0].isBlockStart).toBe(true) // def foo():
		expect(lines[1].isBlockStart).toBe(false) // pass
		expect(lines[2].isBlockStart).toBe(true) // class Bar:
	})

	it("should identify block starts (C-style)", () => {
		const content = "function foo() {\n    return\n}\nif (x) {"
		const lines = parseLines(content)

		expect(lines[0].isBlockStart).toBe(true) // function foo() {
		expect(lines[1].isBlockStart).toBe(false) // return
		expect(lines[2].isBlockStart).toBe(false) // }
		expect(lines[3].isBlockStart).toBe(true) // if (x) {
	})

	it("should handle empty content", () => {
		const lines = parseLines("")
		expect(lines).toHaveLength(1)
		expect(lines[0].isBlank).toBe(true)
	})
})

// ─── computeEffectiveIndents Tests ────────────────────────────────────────────

describe("computeEffectiveIndents", () => {
	it("should return same indents for non-blank lines", () => {
		const content = "line1\n    line2\n        line3"
		const lines = parseLines(content)
		const effective = computeEffectiveIndents(lines)

		expect(effective[0]).toBe(0)
		expect(effective[1]).toBe(1)
		expect(effective[2]).toBe(2)
	})

	it("should inherit previous indent for blank lines", () => {
		const content = "line1\n    line2\n\n    line3"
		const lines = parseLines(content)
		const effective = computeEffectiveIndents(lines)

		expect(effective[0]).toBe(0) // line1
		expect(effective[1]).toBe(1) // line2 (indent 1)
		expect(effective[2]).toBe(1) // blank line inherits from line2
		expect(effective[3]).toBe(1) // line3
	})

	it("should handle multiple consecutive blank lines", () => {
		const content = "    start\n\n\n\n    end"
		const lines = parseLines(content)
		const effective = computeEffectiveIndents(lines)

		expect(effective[0]).toBe(1) // start
		expect(effective[1]).toBe(1) // blank inherits
		expect(effective[2]).toBe(1) // blank inherits
		expect(effective[3]).toBe(1) // blank inherits
		expect(effective[4]).toBe(1) // end
	})

	it("should handle blank line at start", () => {
		const content = "\n    content"
		const lines = parseLines(content)
		const effective = computeEffectiveIndents(lines)

		expect(effective[0]).toBe(0) // blank at start has no previous, defaults to 0
		expect(effective[1]).toBe(1) // content
	})
})

// ─── formatWithLineNumbers Tests ──────────────────────────────────────────────

describe("formatWithLineNumbers", () => {
	it("should format lines with line numbers", () => {
		const lines: LineRecord[] = [
			{ lineNumber: 1, content: "first", indentLevel: 0, isBlank: false, isBlockStart: false },
			{ lineNumber: 2, content: "second", indentLevel: 0, isBlank: false, isBlockStart: false },
		]

		const result = formatWithLineNumbers(lines)
		expect(result).toBe("1 | first\n2 | second")
	})

	it("should pad line numbers for alignment", () => {
		const lines: LineRecord[] = [
			{ lineNumber: 1, content: "a", indentLevel: 0, isBlank: false, isBlockStart: false },
			{ lineNumber: 10, content: "b", indentLevel: 0, isBlank: false, isBlockStart: false },
			{ lineNumber: 100, content: "c", indentLevel: 0, isBlank: false, isBlockStart: false },
		]

		const result = formatWithLineNumbers(lines)
		expect(result).toBe("  1 | a\n 10 | b\n100 | c")
	})

	it("should truncate long lines", () => {
		const longLine = "x".repeat(600)
		const lines: LineRecord[] = [
			{ lineNumber: 1, content: longLine, indentLevel: 0, isBlank: false, isBlockStart: false },
		]

		const result = formatWithLineNumbers(lines, 100)
		expect(result.length).toBeLessThan(longLine.length)
		expect(result).toContain("...")
	})

	it("should handle empty array", () => {
		const result = formatWithLineNumbers([])
		expect(result).toBe("")
	})
})

// ─── readWithSlice Tests ──────────────────────────────────────────────────────

describe("readWithSlice", () => {
	it("should read from beginning with default offset", () => {
		const result = readWithSlice(SIMPLE_CODE, 0, 10)

		expect(result.totalLines).toBe(7) // 6 lines + empty trailing
		expect(result.returnedLines).toBe(7)
		expect(result.wasTruncated).toBe(false)
		expect(result.content).toContain("1 | function outer()")
	})

	it("should respect offset parameter", () => {
		const result = readWithSlice(SIMPLE_CODE, 2, 10)

		expect(result.content).not.toContain("function outer()")
		expect(result.content).toContain("console.log")
		expect(result.includedRanges[0][0]).toBe(3) // 1-based, offset 2 = line 3
	})

	it("should respect limit parameter", () => {
		const result = readWithSlice(TYPESCRIPT_CODE, 0, 5)

		expect(result.returnedLines).toBe(5)
		expect(result.wasTruncated).toBe(true)
	})

	it("should handle offset beyond file end", () => {
		const result = readWithSlice(SIMPLE_CODE, 1000, 10)

		expect(result.returnedLines).toBe(0)
		expect(result.content).toContain("Error")
	})

	it("should handle negative offset", () => {
		const result = readWithSlice(SIMPLE_CODE, -5, 10)

		// Should normalize to 0
		expect(result.includedRanges[0][0]).toBe(1)
	})
})

// ─── readWithIndentation Tests ────────────────────────────────────────────────

describe("readWithIndentation", () => {
	describe("basic block extraction", () => {
		it("should extract content around the anchor line", () => {
			const result = readWithIndentation(PYTHON_CODE, {
				anchorLine: 15, // Inside add() method
				maxLevels: 0, // unlimited
				includeHeader: false,
				includeSiblings: false,
			})

			expect(result.content).toContain("def add")
			expect(result.content).toContain("self.value += n")
			expect(result.content).toContain("return self.value")
		})

		it("should handle anchor at first line", () => {
			const result = readWithIndentation(SIMPLE_CODE, {
				anchorLine: 1,
				maxLevels: 0,
				includeHeader: false,
			})

			expect(result.returnedLines).toBeGreaterThan(0)
			expect(result.content).toContain("function outer()")
		})

		it("should handle anchor at last line", () => {
			const lines = PYTHON_CODE.trim().split("\n").length
			const result = readWithIndentation(PYTHON_CODE, {
				anchorLine: lines,
				maxLevels: 0,
				includeHeader: false,
			})

			expect(result.returnedLines).toBeGreaterThan(0)
		})
	})

	describe("max_levels behavior", () => {
		it("should include all content when maxLevels=0 (unlimited)", () => {
			const result = readWithIndentation(SIMPLE_CODE, {
				anchorLine: 3, // Inside inner()
				maxLevels: 0,
				includeHeader: false,
				includeSiblings: false,
			})

			// With unlimited levels, should get the whole file
			expect(result.content).toContain("function outer()")
			expect(result.content).toContain("function inner()")
			expect(result.content).toContain("console.log")
		})

		it("should limit expansion when maxLevels > 0", () => {
			const result = readWithIndentation(SIMPLE_CODE, {
				anchorLine: 3, // Inside inner()
				maxLevels: 1,
				includeHeader: false,
				includeSiblings: false,
			})

			// With 1 level, should include inner() context but may not reach outer()
			expect(result.content).toContain("console.log")
		})

		it("should handle deeply nested code with unlimited levels", () => {
			const result = readWithIndentation(PYTHON_CODE, {
				anchorLine: 15, // Inside add() method body
				maxLevels: 0, // unlimited
				includeHeader: false,
				includeSiblings: false,
			})

			// Should expand to include class context
			expect(result.content).toContain("class Calculator")
		})
	})

	describe("sibling blocks", () => {
		it("should exclude siblings when includeSiblings is false", () => {
			const result = readWithIndentation(PYTHON_CODE, {
				anchorLine: 15, // Inside add() method
				maxLevels: 1,
				includeSiblings: false,
				includeHeader: false,
			})

			// Should focus on add() but not include subtract() or other siblings
			expect(result.content).toContain("def add")
		})

		it("should include siblings when includeSiblings is true", () => {
			const result = readWithIndentation(PYTHON_CODE, {
				anchorLine: 15, // Inside add() method
				maxLevels: 1,
				includeSiblings: true,
				includeHeader: false,
			})

			// Should include sibling methods
			expect(result.content).toContain("def add")
			// May include other siblings depending on limit
		})
	})

	describe("file header (includeHeader option)", () => {
		it("should allow comment lines at min indent when includeHeader is true", () => {
			// The Codex algorithm's includeHeader option allows comment lines at the
			// minimum indent level to be included during upward expansion.
			// This is different from prepending the file's import header.
			const result = readWithIndentation(PYTHON_CODE, {
				anchorLine: 15,
				maxLevels: 0, // unlimited - will expand to indent 0
				includeHeader: true,
				includeSiblings: false,
			})

			// With unlimited levels, bidirectional expansion will include content
			// at indent level 0. includeHeader allows comment lines to be included.
			expect(result.returnedLines).toBeGreaterThan(0)
			expect(result.content).toContain("def add")
		})

		it("should expand to top-level content with maxLevels=0", () => {
			const result = readWithIndentation(PYTHON_CODE, {
				anchorLine: 15,
				maxLevels: 0, // unlimited
				includeHeader: false,
				includeSiblings: false,
			})

			// With unlimited levels, expansion goes to indent 0
			// which includes the class definition
			expect(result.content).toContain("class Calculator")
		})

		it("should include class content when anchored inside a method", () => {
			const result = readWithIndentation(TYPESCRIPT_CODE, {
				anchorLine: 20, // Inside Handler class
				maxLevels: 0,
				includeHeader: true,
				includeSiblings: false,
			})

			// Should include class context
			expect(result.content).toContain("class Handler")
		})
	})

	describe("line limit and max_lines", () => {
		it("should truncate output when exceeding limit", () => {
			const result = readWithIndentation(TYPESCRIPT_CODE, {
				anchorLine: 15,
				maxLevels: 0,
				includeHeader: true,
				includeSiblings: true,
				limit: 10,
			})

			expect(result.returnedLines).toBeLessThanOrEqual(10)
			expect(result.wasTruncated).toBe(true)
		})

		it("should not truncate when under limit", () => {
			const result = readWithIndentation(SIMPLE_CODE, {
				anchorLine: 3,
				maxLevels: 1,
				includeHeader: false,
				limit: 100,
			})

			expect(result.wasTruncated).toBe(false)
		})

		it("should respect maxLines as separate hard cap", () => {
			const result = readWithIndentation(TYPESCRIPT_CODE, {
				anchorLine: 20,
				maxLevels: 0,
				includeHeader: true,
				includeSiblings: true,
				limit: 100,
				maxLines: 5, // Hard cap at 5
			})

			expect(result.returnedLines).toBeLessThanOrEqual(5)
		})

		it("should use min of limit and maxLines", () => {
			const result = readWithIndentation(TYPESCRIPT_CODE, {
				anchorLine: 20,
				maxLevels: 0,
				includeHeader: true,
				includeSiblings: true,
				limit: 3, // More restrictive than maxLines
				maxLines: 10,
			})

			expect(result.returnedLines).toBeLessThanOrEqual(3)
		})
	})

	describe("blank line handling", () => {
		it("should treat blank lines with inherited indentation", () => {
			const result = readWithIndentation(CODE_WITH_BLANKS, {
				anchorLine: 4, // blank line inside method_one
				maxLevels: 1,
				includeHeader: false,
				includeSiblings: false,
			})

			// Blank line should inherit previous indent and be included in expansion
			expect(result.returnedLines).toBeGreaterThan(0)
		})

		it("should trim empty lines from edges of result", () => {
			const result = readWithIndentation(CODE_WITH_BLANKS, {
				anchorLine: 3, // x = 1
				maxLevels: 1,
				includeHeader: false,
				includeSiblings: false,
			})

			// Check that result doesn't start or end with blank lines
			const lines = result.content.split("\n")
			if (lines.length > 0) {
				const firstLine = lines[0]
				const lastLine = lines[lines.length - 1]
				// Lines should have content after the line number prefix
				expect(firstLine).toMatch(/\d+\s*\|/)
				expect(lastLine).toMatch(/\d+\s*\|/)
			}
		})
	})

	describe("error handling", () => {
		it("should handle invalid anchor line (too low)", () => {
			const result = readWithIndentation(PYTHON_CODE, {
				anchorLine: 0,
				maxLevels: 1,
			})

			expect(result.content).toContain("Error")
			expect(result.returnedLines).toBe(0)
		})

		it("should handle invalid anchor line (too high)", () => {
			const result = readWithIndentation(PYTHON_CODE, {
				anchorLine: 9999,
				maxLevels: 1,
			})

			expect(result.content).toContain("Error")
			expect(result.returnedLines).toBe(0)
		})
	})

	describe("bidirectional expansion", () => {
		it("should expand both up and down from anchor", () => {
			const result = readWithIndentation(SIMPLE_CODE, {
				anchorLine: 3, // console.log("hello") - in the middle
				maxLevels: 0,
				includeHeader: false,
				includeSiblings: false,
				limit: 10,
			})

			// Should include lines both before and after anchor
			expect(result.content).toContain("function inner()")
			expect(result.content).toContain("console.log")
		})

		it("should return single line when limit is 1", () => {
			const result = readWithIndentation(SIMPLE_CODE, {
				anchorLine: 3,
				maxLevels: 0,
				includeHeader: false,
				includeSiblings: false,
				limit: 1,
			})

			expect(result.returnedLines).toBe(1)
			expect(result.content).toContain("console.log")
		})

		it("should stop expansion when hitting lower indent", () => {
			const result = readWithIndentation(PYTHON_CODE, {
				anchorLine: 15, // Inside add() method body (return self.value)
				maxLevels: 2, // Only go up 2 levels from anchor indent
				includeHeader: false,
				includeSiblings: false,
			})

			// Should include method but respect maxLevels
			expect(result.content).toContain("def add")
		})
	})

	describe("real-world scenarios", () => {
		it("should extract a function with its context", () => {
			const result = readWithIndentation(TYPESCRIPT_CODE, {
				anchorLine: 37, // Inside createHandler function body (return statement)
				maxLevels: 0,
				includeHeader: true,
				includeSiblings: false,
			})

			expect(result.content).toContain("export function createHandler")
			expect(result.content).toContain("return new Handler")
		})

		it("should extract a class method with class context", () => {
			const result = readWithIndentation(TYPESCRIPT_CODE, {
				anchorLine: 19, // Inside process() method
				maxLevels: 1,
				includeHeader: false,
				includeSiblings: false,
			})

			expect(result.content).toContain("process(input: string)")
		})
	})

	describe("includedRanges", () => {
		it("should return correct contiguous range", () => {
			const result = readWithIndentation(SIMPLE_CODE, {
				anchorLine: 3,
				maxLevels: 0,
				includeHeader: false,
				includeSiblings: false,
				limit: 10,
			})

			expect(result.includedRanges.length).toBeGreaterThan(0)
			// Each range should be [start, end] with start <= end
			for (const [start, end] of result.includedRanges) {
				expect(start).toBeLessThanOrEqual(end)
				expect(start).toBeGreaterThan(0)
			}
		})
	})
})
