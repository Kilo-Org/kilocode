import { ReactNode } from "react"
import { getHighlighter } from "./highlighter"
import { toJsxRuntime } from "hast-util-to-jsx-runtime"
import { Fragment, jsx, jsxs } from "react/jsx-runtime"

/**
 * Highlight two pieces of code (old and new) in a single pass and return
 * arrays of ReactNode representing each line
 */
export async function highlightHunks(
	oldText: string,
	newText: string,
	lang: string,
	theme: "light" | "dark",
	_hunkIndex = 0,
	_filePath?: string,
): Promise<{ oldLines: ReactNode[]; newLines: ReactNode[] }> {
	try {
		const highlighter = await getHighlighter(lang)
		const shikiTheme = theme === "light" ? "github-light" : "github-dark"

		// Helper to highlight text and extract lines
		const highlightAndExtractLines = (text: string): ReactNode[] => {
			const textLines = text.split("\n")

			if (!text.trim()) {
				return textLines.map((line) => line || "")
			}

			try {
				// Use Shiki's line transformer to get per-line highlighting
				const hast: any = highlighter.codeToHast(text, {
					lang,
					theme: shikiTheme,
					transformers: [
						{
							pre(node: any) {
								node.properties.style = "padding:0;margin:0;background:none;"
								return node
							},
							code(node: any) {
								node.properties.class = `hljs language-${lang}`
								return node
							},
							line(node: any, line: number) {
								// Add a line marker to help with extraction
								node.properties["data-line"] = line
								return node
							},
						},
					],
				})

				// Extract the <code> element's children (which should be line elements)
				const codeEl = hast?.children?.[0]?.children?.[0]
				if (!codeEl || !codeEl.children) {
					return textLines.map((line) => line || "")
				}

				// Convert each line element to a ReactNode
				const highlightedLines: ReactNode[] = []

				for (const lineNode of codeEl.children) {
					if (lineNode.tagName === "span" && lineNode.properties?.className?.includes("line")) {
						// This is a line span from Shiki
						const reactNode = toJsxRuntime(
							{ type: "element", tagName: "span", properties: {}, children: lineNode.children || [] },
							{ Fragment, jsx, jsxs },
						)
						highlightedLines.push(reactNode)
					}
				}

				// If we didn't get the expected structure, fall back to simple approach
				if (highlightedLines.length !== textLines.length) {
					// For each line, highlight it individually (fallback)
					return textLines.map((line) => {
						if (!line.trim()) return line

						try {
							const lineHast: any = highlighter.codeToHast(line, {
								lang,
								theme: shikiTheme,
								transformers: [
									{
										pre(node: any) {
											node.properties.style = "padding:0;margin:0;background:none;"
											return node
										},
										code(node: any) {
											node.properties.class = `hljs language-${lang}`
											return node
										},
									},
								],
							})

							const lineCodeEl = lineHast?.children?.[0]?.children?.[0]
							if (!lineCodeEl || !lineCodeEl.children) {
								return line
							}

							return toJsxRuntime(
								{ type: "element", tagName: "span", properties: {}, children: lineCodeEl.children },
								{ Fragment, jsx, jsxs },
							)
						} catch {
							return line
						}
					})
				}

				return highlightedLines
			} catch {
				return textLines.map((line) => line || "")
			}
		}

		// Process both old and new text
		const oldLines = highlightAndExtractLines(oldText)
		const newLines = highlightAndExtractLines(newText)

		return { oldLines, newLines }
	} catch {
		// Fallback to plain text on any error
		return {
			oldLines: oldText.split("\n").map((line) => line || ""),
			newLines: newText.split("\n").map((line) => line || ""),
		}
	}
}
