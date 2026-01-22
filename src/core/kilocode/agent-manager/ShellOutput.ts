import stripAnsi from "strip-ansi"

// this strips any form os OSC sequences from a value coming from a terminal command execution
export function stripOscSequences(value: string): string {
	let result = ""
	let index = 0

	while (index < value.length) {
		if (value[index] === "\x1b" && value[index + 1] === "]") {
			index += 2
			while (index < value.length) {
				const ch = value[index]
				if (ch === "\x07") {
					index += 1
					break
				}
				if (ch === "\x1b" && value[index + 1] === "\\") {
					index += 2
					break
				}
				index += 1
			}
			continue
		}
		result += value[index]
		index += 1
	}

	return result
}

export function stripShellControlCodes(value: string): string {
	return stripAnsi(stripOscSequences(value))
}
