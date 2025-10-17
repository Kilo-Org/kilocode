import * as vscode from "vscode"

export interface EditorConfig {
	fontSize: number
	fontFamily: string
	lineHeight: number
}

/**
 * Get all editor configuration values in one call
 */
export function getEditorConfiguration(): EditorConfig {
	const config = vscode.workspace.getConfiguration("editor")
	const fontSize = config.get<number>("fontSize") || 14
	const fontFamily = config.get<string>("fontFamily") || "Consolas, 'Courier New', monospace"
	const rawLineHeight = config.get<number>("lineHeight") || 1.5

	// VS Code lineHeight can be either:
	// - A multiplier (like 1.2) if < 8
	// - An absolute pixel value (like 18) if >= 8
	const lineHeight = rawLineHeight < 8 ? rawLineHeight : rawLineHeight / fontSize

	return { fontSize, fontFamily, lineHeight }
}
