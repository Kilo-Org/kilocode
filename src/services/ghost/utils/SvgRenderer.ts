// kilocode_change - new file: SvgRenderer class for Shiki HTML-to-SVG conversion with diff highlighting
import { escapeHtml } from "../../../shared/utils/escapeHtml"
import { parseHtmlDocument } from "./htmlParser"
import { calculateTextWidth } from "./textMeasurement"
import { type ThemeColors } from "./ThemeMapper"

// DOM Node type constants for cross-environment compatibility
const TEXT_NODE = 3

interface SvgRenderOptions {
	width: number
	height: number
	fontSize: number
	fontFamily: string
	fontWeight?: string
	letterSpacing: number
	lineHeight: number
	themeColors: ThemeColors
}

export class SvgRenderer {
	constructor(
		private html: string,
		private options: SvgRenderOptions,
	) {}

	public render(): string {
		const { guts, lineBackgrounds, characterBackgrounds } = this.convertShikiHtmlToSvgContent()

		const lines = this.html.split("\n")
		const actualHeight = lines.length * this.options.lineHeight

		return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.options.width}" height="${actualHeight}" shape-rendering="crispEdges">
			<g>
				<rect x="0" y="0" rx="10" ry="10" width="${this.options.width}" height="${actualHeight}" fill="${this.options.themeColors.background}" shape-rendering="crispEdges" />
				${lineBackgrounds}
				${characterBackgrounds}
				${guts}
			</g>
		</svg>`
	}

	private convertShikiHtmlToSvgContent(): {
		guts: string
		lineBackgrounds: string
		characterBackgrounds: string
	} {
		const document = parseHtmlDocument(this.html)
		const lines = Array.from(document.querySelectorAll(".line"))

		const characterBackgrounds: string[] = []
		let currentX = 0

		const svgLines = lines.map((line: Element, index: number) => {
			const lineY = index * this.options.lineHeight + this.options.lineHeight / 2
			currentX = 0

			const spans = Array.from(line.childNodes)
				.map((node: ChildNode) => {
					if (node.nodeType === TEXT_NODE) {
						const textContent = node.textContent ?? ""
						const estimatedWidth = calculateTextWidth(textContent, this.options.fontSize)
						currentX += estimatedWidth
						return `<tspan xml:space="preserve">${escapeHtml(textContent)}</tspan>`
					}

					const el = node as HTMLElement
					const style = el.getAttribute("style") || ""
					const colorMatch = style.match(/color:\s*(#[0-9a-fA-F]{6})/)
					const backgroundColorMatch = style.match(/background-color:\s*(#[0-9a-fA-F]{6,8}|rgba?\([^)]+\))/)
					const classes = el.getAttribute("class") || ""
					const fill = colorMatch ? ` fill="${colorMatch[1]}"` : ""

					const content = el.textContent || ""
					const estimatedWidth = calculateTextWidth(content, this.options.fontSize)

					if (classes.includes("diff-")) {
						let bgColor = this.options.themeColors.modifiedBackground

						if (classes.includes("diff-added")) {
							bgColor = this.options.themeColors.addedBackground
						} else if (classes.includes("diff-removed")) {
							bgColor = this.options.themeColors.removedBackground
						} else if (classes.includes("diff-modified")) {
							bgColor = this.options.themeColors.modifiedBackground
						}

						characterBackgrounds.push(
							`<rect x="${currentX}" y="${index * this.options.lineHeight}" width="${estimatedWidth}" height="${this.options.lineHeight}" fill="${bgColor}" shape-rendering="crispEdges" />`,
						)
					} else if (backgroundColorMatch) {
						characterBackgrounds.push(
							`<rect x="${currentX}" y="${index * this.options.lineHeight}" width="${estimatedWidth}" height="${this.options.lineHeight}" fill="${this.options.themeColors.highlightedBackground}" shape-rendering="crispEdges" />`,
						)
					}

					currentX += estimatedWidth

					return `<tspan xml:space="preserve"${fill}>${escapeHtml(content)}</tspan>`
				})
				.join("")

			const textElement = `<text x="0" y="${lineY}" font-family="${this.options.fontFamily}" font-size="${this.options.fontSize.toString()}" xml:space="preserve" dominant-baseline="central" shape-rendering="crispEdges">${spans}</text>`

			return textElement
		})

		const lineBackgrounds = lines
			.map((line: Element, index: number) => {
				const y = index * this.options.lineHeight
				return `<rect x="0" y="${y}" width="100%" height="${this.options.lineHeight}" fill="${this.options.themeColors.background}" shape-rendering="crispEdges" />`
			})
			.join("\n")

		return {
			guts: svgLines.join("\n"),
			lineBackgrounds,
			characterBackgrounds: characterBackgrounds.join("\n"),
		}
	}
}
