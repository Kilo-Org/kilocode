import { LineStream } from "../../../diff/util"
import { lineIsRepeated } from "../../util/textSimilarity"

export { lineIsRepeated }

export type LineFilter = (args: { lines: LineStream; fullStop: () => void }) => LineStream

export type CharacterFilter = (args: {
	chars: AsyncGenerator<string>
	prefix: string
	suffix: string
	filepath: string
	multiline: boolean
}) => AsyncGenerator<string>

const BRACKET_ENDING_CHARS = [")", "]", "}", ";"]
export const PREFIXES_TO_SKIP = ["<COMPLETION>"]
export const LINES_TO_STOP_AT = ["# End of file.", "<STOP EDITING HERE", "<|/updated_code|>", "```"]

function isBracketEnding(line: string): boolean {
	return line
		.trim()
		.split("")
		.some((char) => BRACKET_ENDING_CHARS.includes(char))
}

/**
 * Validate whether a stop pattern in a line is in a valid context (not inside quotes or identifiers)
 * and capture the text before the pattern.
 * Internal helper for stopAtLines.
 */
function validatePatternInLine(
	line: string,
	pattern: string,
): {
	isValid: boolean
	patternIndex: number
	beforePattern: string
} {
	const patternIndex = line.indexOf(pattern)

	if (patternIndex === -1) {
		return { isValid: false, patternIndex: -1, beforePattern: "" }
	}

	// If preceded by a non-whitespace, treat as part of an identifier
	if (patternIndex > 0) {
		const charBefore = line[patternIndex - 1]
		if (charBefore && !charBefore.match(/\s/)) {
			return { isValid: false, patternIndex, beforePattern: "" }
		}
	}

	const beforePattern = line.substring(0, patternIndex)
	const singleQuotes = (beforePattern.match(/'/g) || []).length
	const doubleQuotes = (beforePattern.match(/"/g) || []).length

	// Odd number of quotes before the pattern - likely inside quotes
	if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
		return { isValid: false, patternIndex, beforePattern }
	}

	return { isValid: true, patternIndex, beforePattern }
}

/**
 * Filter out lines starting with "// Path: <PATH>" which models sometimes echo.
 */
export async function* avoidPathLine(stream: LineStream, comment?: string): LineStream {
	for await (const line of stream) {
		if (comment && line.startsWith(`${comment} Path: `)) {
			continue
		}
		yield line
	}
}

/**
 * Filter out empty comment-only lines.
 */
export async function* avoidEmptyComments(stream: LineStream, comment?: string): LineStream {
	for await (const line of stream) {
		if (!comment || line.trim() !== comment) {
			yield line
		}
	}
}

/**
 * Insert "\n" separators between streamed lines.
 */
export async function* streamWithNewLines(stream: LineStream): LineStream {
	let firstLine = true
	for await (const nextLine of stream) {
		if (!firstLine) {
			yield "\n"
		}
		firstLine = false
		yield nextLine
	}
}

/**
 * Yield until a line equals or is very similar to the provided line, then call fullStop.
 * If the provided line ends with a bracket/semicolon, allow exact trimmed matches to pass through.
 */
export async function* stopAtSimilarLine(
	stream: LineStream,
	line: string,
	fullStop: () => void,
): AsyncGenerator<string> {
	const trimmedLine = line.trim()
	const lineIsBracketEnding = isBracketEnding(trimmedLine)

	for await (const nextLine of stream) {
		if (trimmedLine === "") {
			yield nextLine
			continue
		}

		if (lineIsBracketEnding && trimmedLine === nextLine.trim()) {
			yield nextLine
			continue
		}

		if (nextLine === line) {
			fullStop()
			break
		}

		if (lineIsRepeated(nextLine, trimmedLine)) {
			fullStop()
			break
		}

		yield nextLine
	}
}

/**
 * Yield until any of the stop phrases is encountered in a valid context, then call fullStop.
 */
export async function* stopAtLines(
	stream: LineStream,
	fullStop: () => void,
	linesToStopAt: string[] = LINES_TO_STOP_AT,
): LineStream {
	for await (const line of stream) {
		let shouldStop = false

		for (const stopAt of linesToStopAt) {
			if (line.includes(stopAt)) {
				const validation = validatePatternInLine(line, stopAt)
				if (!validation.isValid) {
					continue
				}

				const trimmedLine = line.trimStart()
				if (trimmedLine.startsWith(stopAt)) {
					shouldStop = true
					break
				} else {
					const contentBeforeStopPhrase = validation.beforePattern.trimEnd()
					if (contentBeforeStopPhrase.length < validation.beforePattern.length) {
						shouldStop = true
						break
					}
				}
			}
		}

		if (shouldStop) {
			fullStop()
			break
		}
		yield line
	}
}

/**
 * Yield until an exact stop line is encountered, then call fullStop.
 */
export async function* stopAtLinesExact(stream: LineStream, fullStop: () => void, linesToStopAt: string[]): LineStream {
	for await (const line of stream) {
		if (linesToStopAt.some((stopAt) => line === stopAt)) {
			fullStop()
			break
		}
		yield line
	}
}

/**
 * On the first line only, strip any configured prefix (e.g. "<COMPLETION>").
 */
export async function* skipPrefixes(lines: LineStream): LineStream {
	let isFirstLine = true
	for await (const line of lines) {
		if (isFirstLine) {
			const match = PREFIXES_TO_SKIP.find((prefix) => line.startsWith(prefix))
			if (match) {
				yield line.slice(match.length)
				continue
			}
			isFirstLine = false
		}
		yield line
	}
}

/**
 * Yield lines until a line repeats 3 times consecutively. Only the first of the repeats is yielded.
 */
export async function* stopAtRepeatingLines(lines: LineStream, fullStop: () => void): LineStream {
	let previousLine: string | undefined
	let repeatCount = 0
	const MAX_REPEATS = 3

	for await (const line of lines) {
		if (line === previousLine) {
			repeatCount++
			if (repeatCount === MAX_REPEATS) {
				fullStop()
				return
			}
		} else {
			yield line
			repeatCount = 1
		}
		previousLine = line
	}
}

/**
 * Pass through lines, but if the stream takes longer than ms after we have at least one non-empty line, stop early.
 */
export async function* showWhateverWeHaveAtXMs(lines: LineStream, ms: number): LineStream {
	const startTime = Date.now()
	let firstNonWhitespaceLineYielded = false

	for await (const line of lines) {
		yield line

		if (!firstNonWhitespaceLineYielded && line.trim() !== "") {
			firstNonWhitespaceLineYielded = true
		}

		const isTakingTooLong = Date.now() - startTime > ms
		if (isTakingTooLong && firstNonWhitespaceLineYielded) {
			break
		}
	}
}

/**
 * Yield lines until the first blank line after some content; then stop.
 */
export async function* noDoubleNewLine(lines: LineStream): LineStream {
	let isFirstLine = true

	for await (const line of lines) {
		if (line.trim() === "" && !isFirstLine) {
			return
		}

		isFirstLine = false

		yield line
	}
}
