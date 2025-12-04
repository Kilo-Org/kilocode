import { memo, useMemo, useEffect, useState } from "react"
import { parseUnifiedDiff, type DiffLine } from "@src/utils/parseUnifiedDiff"
import { normalizeLanguage } from "@src/utils/highlighter"
import { getLanguageFromPath } from "@src/utils/getLanguageFromPath"
import { highlightHunks } from "@src/utils/highlightDiff"

interface DiffViewProps {
	source: string
	filePath?: string
}

// Interface for hunk data
interface Hunk {
	lines: DiffLine[]
	oldText: string
	newText: string
	highlightedOldLines?: React.ReactNode[]
	highlightedNewLines?: React.ReactNode[]
}

/**
 * DiffView component renders unified diffs with side-by-side line numbers
 * matching VSCode's diff editor style
 */
const DiffView = memo(({ source, filePath }: DiffViewProps) => {
	// Determine language from file path
	const normalizedLang = useMemo(() => normalizeLanguage(getLanguageFromPath(filePath || "") || "txt"), [filePath])

	const isLightTheme = useMemo(() => {
		if (typeof document === "undefined") return false
		const cls = document.body.className
		return /\bvscode-light\b|\bvscode-high-contrast-light\b/i.test(cls)
	}, [])

	// Disable syntax highlighting for large diffs (performance optimization)
	const shouldHighlight = useMemo(() => {
		const lineCount = source.split("\n").length
		return lineCount <= 1000 // Only highlight diffs with <= 1000 lines
	}, [source])

	// Parse diff and group into hunks
	const diffLines = useMemo(() => parseUnifiedDiff(source, filePath), [source, filePath])

	const hunks = useMemo(() => {
		const result: Hunk[] = []
		let currentHunk: DiffLine[] = []

		for (const line of diffLines) {
			if (line.type === "gap") {
				// Finish current hunk if it has content
				if (currentHunk.length > 0) {
					const oldLines: string[] = []
					const newLines: string[] = []

					for (const hunkLine of currentHunk) {
						if (hunkLine.type === "deletion" || hunkLine.type === "context") {
							oldLines.push(hunkLine.content)
						}
						if (hunkLine.type === "addition" || hunkLine.type === "context") {
							newLines.push(hunkLine.content)
						}
					}

					result.push({
						lines: [...currentHunk],
						oldText: oldLines.join("\n"),
						newText: newLines.join("\n"),
					})
				}

				// Start new hunk with the gap
				currentHunk = [line]
			} else {
				currentHunk.push(line)
			}
		}

		// Add the last hunk if it has content
		if (currentHunk.length > 0 && currentHunk.some((line) => line.type !== "gap")) {
			const oldLines: string[] = []
			const newLines: string[] = []

			for (const hunkLine of currentHunk) {
				if (hunkLine.type === "deletion" || hunkLine.type === "context") {
					oldLines.push(hunkLine.content)
				}
				if (hunkLine.type === "addition" || hunkLine.type === "context") {
					newLines.push(hunkLine.content)
				}
			}

			result.push({
				lines: [...currentHunk],
				oldText: oldLines.join("\n"),
				newText: newLines.join("\n"),
			})
		}

		return result
	}, [diffLines])

	// State for the processed hunks with highlighting
	const [processedHunks, setProcessedHunks] = useState<Hunk[]>(hunks)

	// Effect to handle async highlighting
	useEffect(() => {
		if (!shouldHighlight) {
			setProcessedHunks(hunks)
			return
		}

		const processHunks = async () => {
			const processed: Hunk[] = []

			for (let i = 0; i < hunks.length; i++) {
				const hunk = hunks[i]
				try {
					const highlighted = await highlightHunks(
						hunk.oldText,
						hunk.newText,
						normalizedLang,
						isLightTheme ? "light" : "dark",
						i,
						filePath,
					)
					processed.push({
						...hunk,
						highlightedOldLines: highlighted.oldLines,
						highlightedNewLines: highlighted.newLines,
					})
				} catch {
					// Fall back to unhighlighted on error
					processed.push(hunk)
				}
			}

			setProcessedHunks(processed)
		}

		processHunks()
	}, [hunks, shouldHighlight, normalizedLang, isLightTheme, filePath])

	// Render helper that uses precomputed highlighting
	const renderContent = (line: DiffLine, hunk: Hunk, lineIndexInHunk: number): React.ReactNode => {
		if (!shouldHighlight || !hunk.highlightedOldLines || !hunk.highlightedNewLines) {
			return line.content
		}

		// Find the line index within the old/new text for this hunk
		const hunkLinesBeforeThis = hunk.lines.slice(0, lineIndexInHunk).filter((l) => l.type !== "gap")

		if (line.type === "deletion") {
			// Count deletions and context lines before this line
			const oldLineIndex = hunkLinesBeforeThis.filter((l) => l.type === "deletion" || l.type === "context").length
			return hunk.highlightedOldLines[oldLineIndex] || line.content
		} else if (line.type === "addition") {
			// Count additions and context lines before this line
			const newLineIndex = hunkLinesBeforeThis.filter((l) => l.type === "addition" || l.type === "context").length
			return hunk.highlightedNewLines[newLineIndex] || line.content
		} else if (line.type === "context") {
			// For context lines, prefer new-side highlighting, fall back to old-side
			const newLineIndex = hunkLinesBeforeThis.filter((l) => l.type === "addition" || l.type === "context").length
			const oldLineIndex = hunkLinesBeforeThis.filter((l) => l.type === "deletion" || l.type === "context").length
			return hunk.highlightedNewLines[newLineIndex] || hunk.highlightedOldLines[oldLineIndex] || line.content
		}

		return line.content
	}

	return (
		<div className="diff-view bg-[var(--vscode-editor-background)] rounded-md overflow-hidden text-[0.95em]">
			<div className="overflow-x-hidden">
				<table className="w-full border-collapse table-auto">
					<tbody>
						{processedHunks.flatMap((hunk, hunkIndex) =>
							hunk.lines.map((line, lineIndex) => {
								const globalIndex = `${hunkIndex}-${lineIndex}`

								// Render compact separator between hunks
								if (line.type === "gap") {
									return (
										<tr key={globalIndex}>
											<td className="w-[45px] text-right pr-3 pl-2 select-none align-top whitespace-nowrap bg-[var(--vscode-editor-background)]" />
											<td className="w-[45px] text-right pr-3 select-none align-top whitespace-nowrap bg-[var(--vscode-editor-background)]" />
											<td className="w-[12px] align-top bg-[var(--vscode-editor-background)]" />
											{/* +/- column (empty for gap) */}
											<td className="w-[16px] text-center select-none bg-[var(--vscode-editor-background)]" />
											<td className="pr-3 whitespace-pre-wrap break-words w-full italic bg-[var(--vscode-editor-background)]">
												{`${line.hiddenCount ?? 0} hidden lines`}
											</td>
										</tr>
									)
								}

								// Use VSCode's built-in diff editor color variables as classes for gutters
								const gutterBgClass =
									line.type === "addition"
										? "bg-[var(--vscode-diffEditor-insertedTextBackground)]"
										: line.type === "deletion"
											? "bg-[var(--vscode-diffEditor-removedTextBackground)]"
											: "bg-[var(--vscode-editorGroup-border)]"

								const contentBgClass =
									line.type === "addition"
										? "diff-content-inserted"
										: line.type === "deletion"
											? "diff-content-removed"
											: "diff-content-context"

								const sign = line.type === "addition" ? "+" : line.type === "deletion" ? "-" : ""

								return (
									<tr key={globalIndex}>
										{/* Old line number */}
										<td
											className={`w-[45px] text-right pr-1 pl-1 select-none align-top whitespace-nowrap ${gutterBgClass}`}>
											{line.oldLineNum || ""}
										</td>
										{/* New line number */}
										<td
											className={`w-[45px] text-right pr-1 select-none align-top whitespace-nowrap ${gutterBgClass}`}>
											{line.newLineNum || ""}
										</td>
										{/* Narrow colored gutter */}
										<td className={`w-[12px] ${gutterBgClass} align-top`} />
										{/* +/- fixed column to prevent wrapping into it */}
										<td
											className={`w-[16px] text-center select-none whitespace-nowrap px-1 ${gutterBgClass}`}>
											{sign}
										</td>
										{/* Code content (no +/- prefix here) */}
										<td
											className={`pl-1 pr-3 whitespace-pre-wrap break-words w-full ${contentBgClass}`}>
											{renderContent(line, hunk, lineIndex)}
										</td>
									</tr>
								)
							}),
						)}
					</tbody>
				</table>
			</div>
		</div>
	)
})

export default DiffView
