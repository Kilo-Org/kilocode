// kilocode_change new file
// Tests for multiline-quoted strings support in parseCommand.
//
// Run with:
// cd src && npx vitest run shared/__tests__/parse-command.spec.ts

import { parseCommand } from "../parse-command"

describe("parseCommand multiline quoted strings", () => {
	it("splits on newlines outside of quotes", () => {
		const input = "echo hello\ngit status\nnpm install"
		expect(parseCommand(input)).toEqual(["echo hello", "git status", "npm install"])
	})

	it("preserves newlines within double quotes", () => {
		const input = `echo "Hello
World"
git status`
		expect(parseCommand(input)).toEqual(['echo "Hello\nWorld"', "git status"])
	})

	it("preserves newlines within single quotes (quotes may be stripped by shell-quote)", () => {
		const input = `echo 'Hello
World'
git status`
		const parsed = parseCommand(input)
		expect(parsed).toHaveLength(2)
		expect(parsed[0]).toContain("Hello\nWorld")
		expect(parsed[1]).toBe("git status")
	})

	it("handles multi-line git commit messages in quotes as a single subcommand within chains", () => {
		const input = `cd /repo && git add src/a.ts src/b.ts && git commit -m "feat: title

- point a
- point b"`
		const parsed = parseCommand(input)
		expect(parsed).toHaveLength(3)
		expect(parsed[2]).toContain('git commit -m "feat: title')
		expect(parsed[2]).toContain("\n- point a\n- point b")
	})
})
