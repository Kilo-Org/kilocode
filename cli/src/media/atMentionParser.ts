import { isImagePath } from "./images.js"
export interface ParsedSegment {
	type: "text" | "atPath"
	content: string
	startIndex: number
	endIndex: number
}

export interface ParsedPrompt {
	segments: ParsedSegment[]
	paths: string[]
	imagePaths: string[]
	otherPaths: string[]
}

const PATH_TERMINATORS = new Set([" ", "\t", "\n", "\r", ",", ";", ")", "]", "}", ">", "|", "&", "'", '"'])
const TRAILING_PUNCTUATION = new Set([".", ",", ":", ";", "!", "?"])

function isEscapedAt(input: string, index: number): boolean {
	return index > 0 && input[index - 1] === "\\"
}

function parseQuotedPath(input: string, startIndex: number): { path: string; endIndex: number } | null {
	let i = startIndex + 2 // skip @ and opening quote
	let path = ""
	const quote = input[startIndex + 1]

	while (i < input.length) {
		const char = input[i]
		if (char === "\\" && i + 1 < input.length) {
			const nextChar = input[i + 1]
			if (nextChar === quote || nextChar === "\\") {
				path += nextChar
				i += 2
				continue
			}
		}
		if (char === quote) {
			return { path, endIndex: i + 1 }
		}
		path += char
		i++
	}

	return path ? { path, endIndex: i } : null
}

function stripTrailingPunctuation(path: string): { path: string; trimmed: boolean } {
	let trimmed = path
	let removed = false
	while (trimmed.length > 0 && TRAILING_PUNCTUATION.has(trimmed[trimmed.length - 1]!)) {
		trimmed = trimmed.slice(0, -1)
		removed = true
	}
	return { path: trimmed, trimmed: removed }
}

function parseUnquotedPath(input: string, startIndex: number): { path: string; endIndex: number } | null {
	let i = startIndex + 1
	let path = ""

	while (i < input.length) {
		const char = input[i]!

		if (char === "\\" && i + 1 < input.length) {
			const nextChar = input[i + 1]!
			if (nextChar === " " || nextChar === "\\" || PATH_TERMINATORS.has(nextChar)) {
				path += nextChar
				i += 2
				continue
			}
		}

		if (PATH_TERMINATORS.has(char)) {
			break
		}

		path += char
		i++
	}

	if (!path) {
		return null
	}

	const { path: trimmedPath, trimmed } = stripTrailingPunctuation(path)
	if (!trimmedPath) {
		return null
	}

	const endIndex = i - (trimmed ? path.length - trimmedPath.length : 0)
	return { path: trimmedPath, endIndex }
}

function extractPath(input: string, startIndex: number): { path: string; endIndex: number } | null {
	if (startIndex + 1 >= input.length) {
		return null
	}

	const nextChar = input[startIndex + 1]
	if (nextChar === '"' || nextChar === "'") {
		return parseQuotedPath(input, startIndex)
	}

	return parseUnquotedPath(input, startIndex)
}

function pushTextSegment(segments: ParsedSegment[], input: string, textStart: number, currentIndex: number): void {
	if (currentIndex > textStart) {
		segments.push({
			type: "text",
			content: input.slice(textStart, currentIndex),
			startIndex: textStart,
			endIndex: currentIndex,
		})
	}
}

function pushPathSegment(
	segments: ParsedSegment[],
	paths: string[],
	imagePaths: string[],
	otherPaths: string[],
	currentIndex: number,
	extracted: { path: string; endIndex: number },
): void {
	segments.push({
		type: "atPath",
		content: extracted.path,
		startIndex: currentIndex,
		endIndex: extracted.endIndex,
	})

	paths.push(extracted.path)

	if (isImagePath(extracted.path)) {
		imagePaths.push(extracted.path)
	} else {
		otherPaths.push(extracted.path)
	}
}

export function parseAtMentions(input: string): ParsedPrompt {
	const segments: ParsedSegment[] = []
	const paths: string[] = []
	const imagePaths: string[] = []
	const otherPaths: string[] = []

	let currentIndex = 0
	let textStart = 0

	while (currentIndex < input.length) {
		const char = input[currentIndex]

		if (char === "@" && !isEscapedAt(input, currentIndex)) {
			const extracted = extractPath(input, currentIndex)
			if (!extracted) {
				currentIndex++
				continue
			}

			pushTextSegment(segments, input, textStart, currentIndex)
			pushPathSegment(segments, paths, imagePaths, otherPaths, currentIndex, extracted)
			currentIndex = extracted.endIndex
			textStart = currentIndex
			continue
		}

		currentIndex++
	}

	if (textStart < input.length) {
		segments.push({
			type: "text",
			content: input.slice(textStart),
			startIndex: textStart,
			endIndex: input.length,
		})
	}

	return { segments, paths, imagePaths, otherPaths }
}

export function extractImagePaths(input: string): string[] {
	return parseAtMentions(input).imagePaths
}

export function removeImageMentions(input: string, placeholder: string = ""): string {
	const parsed = parseAtMentions(input)

	let result = ""
	for (const segment of parsed.segments) {
		if (segment.type === "text") {
			result += segment.content
		} else if (segment.type === "atPath") {
			if (isImagePath(segment.content)) {
				result += placeholder
			} else {
				result += `@${segment.content}`
			}
		}
	}

	return result
}

export function reconstructText(segments: ParsedSegment[], transform?: (segment: ParsedSegment) => string): string {
	if (transform) {
		return segments.map(transform).join("")
	}

	return segments
		.map((seg) => {
			if (seg.type === "text") {
				return seg.content
			}
			return `@${seg.content}`
		})
		.join("")
}
