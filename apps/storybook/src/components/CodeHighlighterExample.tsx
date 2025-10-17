import React, { useState, useEffect } from "react"
import { calculateDiff } from "../../../../src/services/ghost/utils/CharacterDiff"
import { generateHighlightedHtmlWithRanges } from "../../../../src/services/ghost/utils/CodeHighlighter"
import { SvgRenderer } from "../../../../src/services/ghost/utils/SvgRenderer"
export interface CharacterHighlightingProps {
	originalText: string
	newText: string
	language: string
	fontSize: number
	width: number
}

export const SvgCodeHighlighterExample: React.FC<CharacterHighlightingProps> = ({
	originalText: initialOriginalText,
	newText: initialNewText,
	language,
	fontSize,
	width,
}) => {
	const [originalText, setOriginalText] = useState(initialOriginalText)
	const [newText, setNewText] = useState(initialNewText)
	const [svg, setSvg] = useState<string>("")
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		let canceled = false
		const generateSvg = async () => {
			try {
				setLoading(true)

				// Calculate character differences
				const ranges = calculateDiff(originalText, newText)

				// Generate highlighted HTML
				const { html, themeColors } = await generateHighlightedHtmlWithRanges(newText, language, ranges)
				if (canceled) return

				// Create SVG renderer
				const renderer = new SvgRenderer(html, {
					width,
					height: fontSize * 2,
					fontSize,
					fontFamily: "Menlo, Monaco, 'Courier New', monospace",
					letterSpacing: 0,
					lineHeight: fontSize * 1.5,
					themeColors,
				})

				// Render the SVG
				const svgResult = renderer.render()
				setSvg(svgResult)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				setSvg(
					`<svg width="400" height="50"><text x="10" y="25" fill="red">Error: ${errorMessage}</text></svg>`,
				)
			} finally {
				setLoading(false)
			}
		}

		generateSvg()
		return () => {
			canceled = true
		}
	}, [originalText, newText, language, fontSize, width])

	// Update internal state when props change
	useEffect(() => {
		setOriginalText(initialOriginalText)
	}, [initialOriginalText])

	useEffect(() => {
		setNewText(initialNewText)
	}, [initialNewText])

	return (
		<div className="p-4 text-vscode-foreground">
			<h3 className="text-xl font-semibold mb-4">SVG Code Highlighter Demo</h3>

			<div className="flex gap-5 mb-5">
				<div className="flex-1">
					<label className="block mb-1 font-bold text-sm py-1">Original Text</label>
					<textarea
						value={originalText}
						onChange={(e) => setOriginalText(e.target.value)}
						className="w-full h-30 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded p-2 font-mono text-sm resize-y focus:outline-none focus:ring-2 focus:ring-vscode-focusBorder"
					/>
				</div>
				<div className="flex-1">
					<label className="block mb-1 font-bold text-sm py-1">Updated Text</label>
					<textarea
						value={newText}
						onChange={(e) => setNewText(e.target.value)}
						className="w-full h-30 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded p-2 font-mono text-sm resize-y focus:ring-2 focus:ring-vscode-focusBorder"
					/>
				</div>
			</div>

			<div className="flex flex-col">
				<strong className="text-sm py-1">SVG Preview</strong>
				<div className="border border-vscode-input-border p-2.5 rounded">
					{loading && (
						<div className="text-vscode-descriptionForeground italic text-sm mt-1">Generating...</div>
					)}
					<div className="mt-2.5 min-h-[50px]" dangerouslySetInnerHTML={{ __html: svg }} />
				</div>
			</div>
		</div>
	)
}
