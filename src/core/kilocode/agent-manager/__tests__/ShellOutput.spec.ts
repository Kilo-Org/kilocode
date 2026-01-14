import { describe, it, expect } from "vitest"
import { stripOscSequences, stripShellControlCodes } from "../ShellOutput"

describe("ShellOutput", () => {
	it("strips OSC sequences terminated by BEL", () => {
		const input = "\x1b]1337;RemoteHost=host.local\x07/opt/homebrew/bin/kilocode\n"
		expect(stripOscSequences(input)).toBe("/opt/homebrew/bin/kilocode\n")
	})

	it("strips OSC sequences terminated by ST", () => {
		const input = "\x1b]0;title\x1b\\usr/local/bin/kilocode"
		expect(stripOscSequences(input)).toBe("usr/local/bin/kilocode")
	})

	it("strips multiple OSC sequences in one line", () => {
		const input = "a\x1b]0;title\x07b\x1b]1337;RemoteHost=host.local\x07c"
		expect(stripOscSequences(input)).toBe("abc")
	})

	it("strips OSC sequences that appear mid-string", () => {
		const input = "/opt\x1b]0;title\x07/homebrew/bin/kilocode"
		expect(stripOscSequences(input)).toBe("/opt/homebrew/bin/kilocode")
	})

	it("drops unterminated OSC sequences", () => {
		const input = "prefix\x1b]1337;RemoteHost=host.local"
		expect(stripOscSequences(input)).toBe("prefix")
	})

	it("strips ANSI codes after removing OSC sequences", () => {
		const input = "\x1b]1337;RemoteHost=host.local\x07\x1b[32m/path\x1b[0m"
		expect(stripShellControlCodes(input)).toBe("/path")
	})
})
