// Minimal stub for removed codeRenderer functionality
import type { DiffLine, DiffChar } from "../index.js"
export class CodeRenderer {
	private static instance: CodeRenderer

	static getInstance(): CodeRenderer {
		if (!CodeRenderer.instance) {
			CodeRenderer.instance = new CodeRenderer()
		}
		return CodeRenderer.instance
	}

	async setTheme(_theme: string): Promise<void> {
		// No-op stub
	}

	async getDataUri(
		_text: string,
		_languageId: string,
		_options: {
			imageType: "svg"
			fontSize: number
			fontFamily: string
			dimensions: { width: number; height: number }
			lineHeight: number
		},
		_currLineOffsetFromTop: number,
		_newDiffLines: DiffLine[],
		_diffChars: DiffChar[],
	): Promise<string> {
		// Return empty data URI as stub
		return "data:image/svg+xml;base64,"
	}
}
