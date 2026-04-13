import { describe, it, expect } from "bun:test"
import { filterTextForSpeech, detectSentiment } from "../../webview-ui/src/utils/speech-text-filter"

describe("filterTextForSpeech", () => {
	// =========================================================================
	// LAYER 1: STRUCTURAL CODE REMOVAL
	// =========================================================================

	describe("rule 1: fenced code blocks", () => {
		it("removes fenced code blocks with language tag", () => {
			const input = "Here is some code:\n```typescript\nconst x = 1;\nconsole.log(x);\n```\nDone."
			const result = filterTextForSpeech(input)
			expect(result).toContain("(code block omitted)")
			expect(result).not.toContain("const x")
			expect(result).not.toContain("console.log")
			expect(result).toContain("Done.")
		})

		it("removes fenced code blocks without language tag", () => {
			const input = "Example:\n```\nsome code here\n```"
			const result = filterTextForSpeech(input)
			expect(result).toContain("(code block omitted)")
			expect(result).not.toContain("some code here")
		})

		it("removes multiple fenced code blocks", () => {
			const input = "First:\n```\nblock1\n```\nMiddle text.\n```\nblock2\n```\nEnd."
			const result = filterTextForSpeech(input)
			expect(result).not.toContain("block1")
			expect(result).not.toContain("block2")
			expect(result).toContain("Middle text.")
			expect(result).toContain("End.")
		})
	})

	describe("rule 3: inline code backticks", () => {
		it("strips backticks but keeps content", () => {
			const result = filterTextForSpeech("Use `npm install` to install.")
			expect(result).toContain("npm install")
			expect(result).not.toContain("`")
		})

		it("handles multiple inline code spans", () => {
			const result = filterTextForSpeech("Run `foo` then `bar` commands.")
			expect(result).toContain("foo")
			expect(result).toContain("bar")
			expect(result).not.toContain("`")
		})
	})

	// =========================================================================
	// LAYER 2: TOOL/COMMAND ARTIFACT REMOVAL
	// =========================================================================

	describe("rule 4: tool use lines", () => {
		it("removes Running lines", () => {
			const result = filterTextForSpeech("Running bash command in /tmp\nOutput is ready.")
			expect(result).not.toContain("Running bash")
			expect(result).toContain("Output is ready.")
		})

		it("removes Executing lines", () => {
			const result = filterTextForSpeech("Executing npm install\nAll done.")
			expect(result).not.toContain("Executing npm")
			expect(result).toContain("All done.")
		})

		it("removes Reading lines", () => {
			const result = filterTextForSpeech("Reading file contents...\nThe file contains data.")
			expect(result).not.toContain("Reading file")
			expect(result).toContain("The file contains data.")
		})

		it("removes Writing lines", () => {
			const result = filterTextForSpeech("Writing to output.json\nFile saved.")
			expect(result).not.toContain("Writing to")
			expect(result).toContain("File saved.")
		})

		it("removes Searching lines", () => {
			const result = filterTextForSpeech("Searching for pattern in codebase\nFound 3 matches.")
			expect(result).not.toContain("Searching for")
			expect(result).toContain("Found 3 matches.")
		})

		it("removes Building and Compiling lines", () => {
			const result = filterTextForSpeech("Building project...\nCompiling sources...\nBuild complete.")
			expect(result).not.toContain("Building project")
			expect(result).not.toContain("Compiling sources")
			expect(result).toContain("Build complete.")
		})
	})

	describe("rule 5: terminal prompts", () => {
		it("removes $ prompt lines", () => {
			const result = filterTextForSpeech("Here is output:\n$ npm run test\nTests passed.")
			expect(result).not.toContain("$ npm")
			expect(result).toContain("Tests passed.")
		})

		it("removes > prompt lines", () => {
			const result = filterTextForSpeech("Shell output:\n> echo hello\nDone.")
			expect(result).not.toContain("> echo")
			expect(result).toContain("Done.")
		})

		it("removes package manager command lines", () => {
			const input = "npm install express\nyarn add lodash\npnpm update\nPackages installed."
			const result = filterTextForSpeech(input)
			expect(result).not.toContain("npm install")
			expect(result).not.toContain("yarn add")
			expect(result).not.toContain("pnpm update")
			expect(result).toContain("Packages installed.")
		})

		it("removes git command lines", () => {
			const result = filterTextForSpeech("git commit -m 'fix bug'\nCommit created.")
			expect(result).not.toContain("git commit")
			expect(result).toContain("Commit created.")
		})
	})

	describe("rule 6: diff hunks", () => {
		it("removes @@ diff hunk headers", () => {
			const result = filterTextForSpeech("Changes:\n@@ -10,5 +10,7 @@ function foo\nSummary here.")
			expect(result).not.toContain("@@")
			expect(result).toContain("Summary here.")
		})

		it("removes +/- diff lines", () => {
			const input = "Diff:\n+ added line\n- removed line\nEnd of diff."
			const result = filterTextForSpeech(input)
			expect(result).not.toContain("added line")
			expect(result).not.toContain("removed line")
			expect(result).toContain("End of diff.")
		})
	})

	describe("rule 7: stack traces", () => {
		it("removes 'at' stack trace lines", () => {
			const input = "Error occurred:\n    at Object.method (file.js:10:5)\n    at Module._compile (internal/modules/cjs/loader.js:999:30)\nPlease fix this."
			const result = filterTextForSpeech(input)
			expect(result).not.toContain("at Object.method")
			expect(result).not.toContain("at Module._compile")
			expect(result).toContain("Please fix this.")
		})

		it("replaces typed error lines with omission marker", () => {
			const input = "TypeError: Cannot read property 'foo' of undefined\nCheck your code."
			const result = filterTextForSpeech(input)
			expect(result).toContain("(error details omitted)")
			expect(result).not.toContain("Cannot read property")
			expect(result).toContain("Check your code.")
		})

		it("handles ReferenceError and SyntaxError", () => {
			const input = "ReferenceError: x is not defined\nSyntaxError: Unexpected token"
			const result = filterTextForSpeech(input)
			// Two consecutive error markers collapse to "(error omitted)" via rule 25a
			expect(result).toContain("(error omitted)")
			expect(result).not.toContain("x is not defined")
			expect(result).not.toContain("Unexpected token")
		})
	})

	// =========================================================================
	// LAYER 3: CODE IDENTIFIER REMOVAL
	// =========================================================================

	describe("rule 8: long dot-chains", () => {
		it("removes chains of 4+ segments", () => {
			const result = filterTextForSpeech("The value is window.document.body.style.color in the DOM.")
			expect(result).toContain("(code reference)")
			expect(result).not.toContain("window.document.body.style.color")
		})

		it("leaves 2-segment chains alone", () => {
			const result = filterTextForSpeech("Use console.log for debugging.")
			expect(result).toContain("console.log")
			expect(result).not.toContain("(code reference)")
		})
	})

	describe("rule 10: JSON-like blocks", () => {
		it("removes JSON objects", () => {
			const input = 'The config is { "name": "test", "version": "1.0" } in package.json.'
			const result = filterTextForSpeech(input)
			expect(result).toContain("(data omitted)")
			expect(result).not.toContain('"name"')
		})
	})

	// =========================================================================
	// LAYER 4: MARKDOWN CLEANUP
	// =========================================================================

	describe("rule 11: markdown headings", () => {
		it("removes # heading markers", () => {
			const result = filterTextForSpeech("# Title\nSome content")
			expect(result).not.toMatch(/^#/)
			expect(result).toContain("Title")
			expect(result).toContain("Some content")
		})

		it("removes ## and ### markers", () => {
			const result = filterTextForSpeech("## Section\n### Subsection\nContent here.")
			expect(result).not.toContain("##")
			expect(result).toContain("Section")
			expect(result).toContain("Subsection")
		})
	})

	describe("rule 12: bold/italic markers", () => {
		it("strips **bold** markers, keeps text", () => {
			const result = filterTextForSpeech("This is **important** text.")
			expect(result).toContain("important")
			expect(result).not.toContain("**")
		})

		it("strips *italic* markers, keeps text", () => {
			const result = filterTextForSpeech("This is *emphasized* text.")
			expect(result).toContain("emphasized")
			expect(result).not.toMatch(/\*/)
		})

		it("strips ***bold italic*** markers, keeps text", () => {
			const result = filterTextForSpeech("This is ***critical*** info.")
			expect(result).toContain("critical")
			expect(result).not.toContain("***")
		})

		it("strips __bold__ and _italic_ underscore markers", () => {
			const result = filterTextForSpeech("__Bold__ and _italic_ text.")
			expect(result).toContain("Bold")
			expect(result).toContain("italic")
			expect(result).not.toContain("__")
			// Single underscores from the _italic_ pattern should be removed
			expect(result).not.toMatch(/(?<!\w)_(?!\w)/)
		})
	})

	describe("rule 13: markdown links", () => {
		it("removes link, keeps text", () => {
			const result = filterTextForSpeech("Check [the docs](https://example.com) for details.")
			expect(result).toContain("the docs")
			expect(result).not.toContain("https://example.com")
			expect(result).not.toContain("[")
			expect(result).not.toContain("]")
		})
	})

	describe("rule 14: raw URLs", () => {
		it("replaces URLs with (link)", () => {
			const result = filterTextForSpeech("Visit https://www.example.com/path/to/page for more.")
			expect(result).toContain("(link)")
			expect(result).not.toContain("https://www.example.com")
		})

		it("replaces http URLs with (link)", () => {
			const result = filterTextForSpeech("See http://localhost:3000/api/test for the API.")
			expect(result).toContain("(link)")
			expect(result).not.toContain("http://localhost")
		})
	})

	describe("rule 15: file paths", () => {
		it("removes Unix file paths", () => {
			const result = filterTextForSpeech("Edit the file /usr/local/bin/script for changes.")
			expect(result).toContain("(file path)")
			expect(result).not.toContain("/usr/local/bin")
		})

		it("removes Windows file paths", () => {
			const result = filterTextForSpeech("Open C:\\Users\\Admin\\Documents\\file.txt to view.")
			expect(result).toContain("(file path)")
			expect(result).not.toContain("C:\\Users")
		})
	})

	describe("rule 17: list markers", () => {
		it("removes numbered list markers, keeps content", () => {
			const result = filterTextForSpeech("Steps:\n1. Step one\n2. Step two")
			expect(result).toContain("Step one")
			expect(result).toContain("Step two")
			expect(result).not.toMatch(/^\d+\. /m)
		})

		it("removes * list markers, keeps content", () => {
			// Note: dash (-) and plus (+) list items are also matched by diff hunk
			// rule 6 (/^[+-]{1,3}\s.*$/) which runs first and removes the whole line.
			// The * marker is only handled by the list rule.
			const result = filterTextForSpeech("* Star item\n* Another star item")
			expect(result).toContain("Star item")
			expect(result).toContain("Another star item")
		})

		it("dash list markers are removed by diff rule", () => {
			// Dash list items match diff rule 6 pattern /^[+-]{1,3}\s.*$/
			// so the entire line is removed (not just the marker).
			const result = filterTextForSpeech("Items:\n- First item\n- Second item")
			expect(result).not.toContain("First item")
			expect(result).not.toContain("Second item")
		})
	})

	describe("rule 19: HTML tags", () => {
		it("removes HTML tags, keeps content", () => {
			const result = filterTextForSpeech("This is <b>bold</b> and <i>italic</i> text.")
			expect(result).toContain("bold")
			expect(result).toContain("italic")
			expect(result).not.toContain("<b>")
			expect(result).not.toContain("</b>")
			expect(result).not.toContain("<i>")
		})

		it("removes self-closing tags", () => {
			const result = filterTextForSpeech("Line one<br/>Line two")
			expect(result).not.toContain("<br/>")
			expect(result).toContain("Line one")
			expect(result).toContain("Line two")
		})
	})

	describe("rule 22: strikethrough", () => {
		it("removes ~~ markers, keeps text", () => {
			const result = filterTextForSpeech("This is ~~deleted~~ text.")
			expect(result).toContain("deleted")
			expect(result).not.toContain("~~")
		})
	})

	// =========================================================================
	// LAYER 5: SAFETY LIMITS
	// =========================================================================

	describe("rule 25b: length caps", () => {
		it("caps normal mode at 2000 characters", () => {
			const longText = "A".repeat(3000)
			const result = filterTextForSpeech(longText, "normal")
			expect(result.length).toBeLessThanOrEqual(2003) // 2000 + "..."
			expect(result).toEndWith("...")
		})

		it("does not truncate text under 2000 chars in normal mode", () => {
			const text = "A".repeat(1999)
			const result = filterTextForSpeech(text, "normal")
			expect(result).toBe(text)
		})
	})

	describe("rule 24: brief mode", () => {
		it("returns only the first paragraph", () => {
			const input = "First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph."
			const result = filterTextForSpeech(input, "brief")
			expect(result).toContain("First paragraph here.")
			expect(result).not.toContain("Second paragraph")
			expect(result).not.toContain("Third paragraph")
		})

		it("caps brief mode at 500 characters", () => {
			const longParagraph = "B".repeat(600)
			const result = filterTextForSpeech(longParagraph, "brief")
			expect(result.length).toBeLessThanOrEqual(503) // 500 + "..."
			expect(result).toEndWith("...")
		})
	})

	describe("detailed mode", () => {
		it("allows up to 4000 characters", () => {
			const longText = "C".repeat(5000)
			const result = filterTextForSpeech(longText, "detailed")
			expect(result.length).toBeLessThanOrEqual(4003) // 4000 + "..."
			expect(result).toEndWith("...")
		})

		it("does not truncate text under 4000 chars in detailed mode", () => {
			const text = "C".repeat(3999)
			const result = filterTextForSpeech(text, "detailed")
			expect(result).toBe(text)
		})
	})

	describe("rule 25a: omission marker collapse", () => {
		it("collapses multiple consecutive code block omission markers", () => {
			const input = "Text.\n```\nblock1\n```\n```\nblock2\n```\nEnd."
			const result = filterTextForSpeech(input)
			// Multiple consecutive code block omitted markers should collapse
			expect(result).toContain("(code blocks omitted)")
			// There should be exactly one collapsed marker
			const matches = result.match(/\(code blocks? omitted\)/g)
			expect(matches).not.toBeNull()
			expect(matches!.length).toBe(1)
		})

		it("collapses multiple consecutive link markers", () => {
			// Links must be adjacent (no words between) for collapse to trigger
			const input = "See https://a.com https://b.com https://c.com for details."
			const result = filterTextForSpeech(input)
			expect(result).toContain("(links)")
		})

		it("does not collapse non-adjacent link markers", () => {
			const input = "See https://a.com and https://b.com and https://c.com for details."
			const result = filterTextForSpeech(input)
			// Each link is replaced individually; "and" separates them so no collapse
			expect(result).toContain("(link)")
		})

		it("collapses multiple consecutive file path markers", () => {
			// Paths must be adjacent for collapse to trigger
			const input = "Files at /usr/local/bin/foo /usr/local/lib/bar /opt/local/share/baz are relevant."
			const result = filterTextForSpeech(input)
			expect(result).toContain("(file paths)")
		})

		it("collapses multiple consecutive error omission markers", () => {
			const input = "Error: first problem\nTypeError: second problem\nRangeError: third issue"
			const result = filterTextForSpeech(input)
			expect(result).toContain("(error omitted)")
		})
	})

	// =========================================================================
	// EDGE CASES
	// =========================================================================

	describe("edge cases", () => {
		it("handles empty string", () => {
			expect(filterTextForSpeech("")).toBe("")
		})

		it("handles plain text with no markdown", () => {
			const plain = "This is a normal sentence with no special formatting."
			expect(filterTextForSpeech(plain)).toBe(plain)
		})

		it("defaults to normal verbosity", () => {
			const longText = "D".repeat(3000)
			const result = filterTextForSpeech(longText)
			expect(result.length).toBeLessThanOrEqual(2003)
		})
	})
})

describe("detectSentiment", () => {
	describe("positive sentiment", () => {
		it("detects positive from success keywords", () => {
			const result = detectSentiment("The build was a success and all tests passed, everything is working great.")
			expect(result.mood).toBe("positive")
		})

		it("detects positive from completed/done keywords", () => {
			const result = detectSentiment("Task completed. Migration is done and everything is ready and approved.")
			expect(result.mood).toBe("positive")
		})

		it("returns pitchModifier of +1 for positive", () => {
			const result = detectSentiment("Everything is working great, tests passed, build success, all finished.")
			expect(result.pitchModifier).toBe(1)
		})

		it("returns rateModifier of 1.05 for positive", () => {
			const result = detectSentiment("Everything is working great, tests passed, build success, all finished.")
			expect(result.rateModifier).toBe(1.05)
		})
	})

	describe("negative sentiment", () => {
		it("detects negative from error/failed keywords", () => {
			const result = detectSentiment("The deployment failed with a critical error. There was a fatal crash and the service is broken.")
			expect(result.mood).toBe("negative")
		})

		it("detects negative from problem/issue keywords", () => {
			const result = detectSentiment("Found a critical bug, the timeout issue is a major problem. Access was denied.")
			expect(result.mood).toBe("negative")
		})

		it("returns pitchModifier of -1 for negative", () => {
			const result = detectSentiment("Fatal error, service crashed, build failed, request was rejected and denied.")
			expect(result.pitchModifier).toBe(-1)
		})

		it("returns rateModifier of 0.95 for negative", () => {
			const result = detectSentiment("Fatal error, service crashed, build failed, request was rejected and denied.")
			expect(result.rateModifier).toBe(0.95)
		})
	})

	describe("neutral sentiment", () => {
		it("returns neutral when no strong signal", () => {
			const result = detectSentiment("I updated the configuration file and adjusted the settings.")
			expect(result.mood).toBe("neutral")
		})

		it("returns neutral for balanced positive and negative words", () => {
			// With threshold > 1, equal counts produce neutral
			const result = detectSentiment("The error was fixed successfully.")
			expect(result.mood).toBe("neutral")
		})

		it("returns pitchModifier of 0 for neutral", () => {
			const result = detectSentiment("I updated the configuration file.")
			expect(result.pitchModifier).toBe(0)
		})

		it("returns rateModifier of 1.0 for neutral", () => {
			const result = detectSentiment("I updated the configuration file.")
			expect(result.rateModifier).toBe(1.0)
		})

		it("returns neutral for empty string", () => {
			const result = detectSentiment("")
			expect(result.mood).toBe("neutral")
			expect(result.pitchModifier).toBe(0)
			expect(result.rateModifier).toBe(1.0)
		})
	})

	describe("threshold behavior", () => {
		it("requires more than 1 word difference for non-neutral", () => {
			// One positive word only — not enough gap (needs > positiveCount + 1 difference)
			const result = detectSentiment("The build was a success.")
			expect(result.mood).toBe("neutral")
		})

		it("detects positive only when positive count exceeds negative by more than 1", () => {
			// 3 positive ("success", "passed", "great"), 0 negative => 3 > 0+1 => positive
			const result = detectSentiment("It was a success, tests passed, and the results look great.")
			expect(result.mood).toBe("positive")
		})

		it("detects negative only when negative count exceeds positive by more than 1", () => {
			// 3 negative ("error", "failed", "crash"), 0 positive => 3 > 0+1 => negative
			const result = detectSentiment("There was an error, the build failed, and it caused a crash.")
			expect(result.mood).toBe("negative")
		})
	})
})
