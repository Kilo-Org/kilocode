// kilocode_change new file

import { parseCommand } from "../parse-command"

describe("parseCommand", () => {
	describe("basic command parsing", () => {
		it("parses a simple command", () => {
			expect(parseCommand("git status")).toEqual(["git status"])
		})

		it("parses chained commands with &&", () => {
			expect(parseCommand("git add . && git commit")).toEqual(["git add .", "git commit"])
		})

		it("parses chained commands with ||", () => {
			expect(parseCommand("git pull || git fetch")).toEqual(["git pull", "git fetch"])
		})

		it("parses commands separated by newlines", () => {
			expect(parseCommand("git status\ngit log")).toEqual(["git status", "git log"])
		})

		it("handles empty input", () => {
			expect(parseCommand("")).toEqual([])
			expect(parseCommand("   ")).toEqual([])
		})
	})

	describe("quoted strings", () => {
		it("preserves double-quoted strings", () => {
			expect(parseCommand('echo "hello world"')).toEqual(['echo "hello world"'])
		})

		// Note: shell-quote library strips single quotes, so we test that the content is preserved
		it("preserves content of single-quoted strings", () => {
			expect(parseCommand("echo 'hello world'")).toEqual(["echo hello world"])
		})
	})

	// kilocode_change start - tests for multi-line quoted strings
	describe("multi-line quoted strings", () => {
		it("preserves newlines within double quotes", () => {
			const command = `echo "Hello\nWorld"`
			const result = parseCommand(command)
			expect(result).toHaveLength(1)
			expect(result[0]).toContain("\n")
			expect(result[0]).toBe('echo "Hello\nWorld"')
		})

		// Note: shell-quote library strips single quotes, but newlines are still preserved
		it("preserves newlines within single quotes", () => {
			const command = `echo 'Hello\nWorld'`
			const result = parseCommand(command)
			expect(result).toHaveLength(1)
			expect(result[0]).toContain("\n")
			// Single quotes are stripped by shell-quote, but newline is preserved
			expect(result[0]).toBe("echo Hello\nWorld")
		})

		it("splits on newlines outside quotes but preserves newlines inside quotes", () => {
			const command = `echo "Hello\nWorld"\ngit status`
			const result = parseCommand(command)
			expect(result).toHaveLength(2)
			expect(result[0]).toBe('echo "Hello\nWorld"')
			expect(result[1]).toBe("git status")
		})

		it("handles git commit with multi-line message", () => {
			const command = `git commit -m "feat: title\n\n- point a\n- point b"`
			const result = parseCommand(command)
			expect(result).toHaveLength(1)
			expect(result[0]).toContain("\n")
			expect(result[0]).toContain("- point a")
			expect(result[0]).toContain("- point b")
		})

		it("handles complex git command chain with multi-line commit message", () => {
			const command = `cd /repo && git add . && git commit -m "feat: title\n\n- point a\n- point b"`
			const result = parseCommand(command)
			expect(result).toHaveLength(3)
			expect(result[0]).toBe("cd /repo")
			expect(result[1]).toBe("git add .")
			expect(result[2]).toContain("git commit -m")
			expect(result[2]).toContain("\n")
		})

		it("handles CRLF line endings in quotes", () => {
			const command = `echo "Hello\r\nWorld"`
			const result = parseCommand(command)
			expect(result).toHaveLength(1)
			expect(result[0]).toContain("\r\n")
		})
	})
	// kilocode_change end
})
