import * as vscode from "vscode"
import { SvgRenderer } from "./utils/SvgRenderer"
import { getLanguageForDocument, generateHighlightedHtmlWithRanges } from "./utils/CodeHighlighter"
import { type BackgroundRange } from "./utils/CharacterDiff"
import { EditorConfiguration, type EditorConfig } from "./EditorConfiguration"
import { calculateContainerWidth, calculateCharacterWidth } from "./utils/textMeasurement"
import { getThemeColors } from "./utils/ThemeMapper"

export interface SVGDecorationContent {
	text: string
	backgroundRanges: BackgroundRange[]
}

export interface SVGDecorationOptions {
	marginTop?: number
	marginLeft?: number
}

/**
 * Creates SVG decorations with syntax highlighting and background ranges
 */
export class SVGDecorationBuilder {
	private editorConfig: EditorConfiguration

	constructor() {
		this.editorConfig = new EditorConfiguration()
	}

	/**
	 * Create an SVG decoration type that can be applied to an editor
	 * @param content The content to render with background highlighting
	 * @param document The document context for language detection
	 * @param options Additional decoration options
	 * @returns A VS Code TextEditorDecorationType ready to use
	 */
	public async createDecorationType(
		content: SVGDecorationContent,
		document: vscode.TextDocument,
		options: SVGDecorationOptions = {},
	): Promise<vscode.TextEditorDecorationType> {
		const language = getLanguageForDocument(document)
		const config = this.editorConfig.getEditorConfiguration()

		const { width, height } = this.calculateDimensions(content.text, config)
		const processedText = language
			? await this.highlightCode(content.text, language, content.backgroundRanges)
			: content.text

		const svgContent = this.renderSvg(processedText, width, height, config)
		const svgDataUri = this.createDataUri(svgContent)

		return this.createDecorationTypeFromDataUri(svgDataUri, width, height, config, options)
	}

	/**
	 * Highlight code using Shiki with background ranges for character-level highlighting
	 */
	private async highlightCode(text: string, language: string, backgroundRanges: BackgroundRange[]): Promise<string> {
		try {
			const result = await generateHighlightedHtmlWithRanges(text, language, backgroundRanges)
			return result.html
		} catch (error) {
			console.error("Failed to highlight code with Shiki:", error)
			// Fallback to plain text
			return text
		}
	}

	/**
	 * Calculate dimensions for the SVG based on text content
	 */
	private calculateDimensions(text: string, config: EditorConfig): { width: number; height: number } {
		const lines = text.split("\n")
		const width = calculateContainerWidth(text, config.fontSize)
		const height = lines.length * config.fontSize * config.lineHeight

		return {
			width: Math.round(width),
			height: Math.round(height),
		}
	}

	/**
	 * Render SVG content using the SvgRenderer
	 */
	private renderSvg(processedText: string, width: number, height: number, config: EditorConfig): string {
		const themeColors = getThemeColors()
		const renderer = new SvgRenderer(processedText, {
			width,
			height,
			fontSize: config.fontSize,
			fontFamily: config.fontFamily,
			fontWeight: "normal",
			letterSpacing: 0,
			lineHeight: config.fontSize * config.lineHeight,
			themeColors,
		})

		return renderer.render()
	}

	/**
	 * Create data URI from SVG content
	 */
	private createDataUri(svgContent: string): string {
		const encodedSvg = encodeURIComponent(svgContent)
		return `data:image/svg+xml,${encodedSvg}`
	}

	/**
	 * Create VS Code decoration type from data URI
	 */
	private createDecorationTypeFromDataUri(
		svgDataUri: string,
		width: number,
		height: number,
		config: EditorConfig,
		options: SVGDecorationOptions,
	): vscode.TextEditorDecorationType {
		const marginTop = options.marginTop ?? Math.ceil(0)
		const marginLeft = options.marginLeft ?? Math.ceil(calculateCharacterWidth(config.fontSize) + 6)

		return vscode.window.createTextEditorDecorationType({
			after: {
				contentIconPath: vscode.Uri.parse(svgDataUri),
				border: `transparent; position: absolute; z-index: 2147483647;
				filter: drop-shadow(4px 4px 0px rgba(0, 0, 0, 0.2)) drop-shadow(-4px -4px 0px rgba(0, 0, 0, 0.2));
				margin-top: ${marginTop}px;
				margin-left: ${marginLeft}px;`,
				width: `${width}px`,
				height: `${height}px`,
			},
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
		})
	}
}
