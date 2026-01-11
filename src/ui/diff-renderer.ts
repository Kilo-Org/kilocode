/**
 * Diff Renderer
 *
 * Renders diff overlays in VSCode editor with proper styling and interactions
 */

import * as vscode from "vscode"
import { DiffOverlay } from "../types/diff-types"
import { Logger } from "../services/error-handler"
import { DiffEventManager } from "../services/event-system"

/**
 * Renders diff overlays with VSCode decoration API
 */
export class DiffRenderer {
	private activeEditor: vscode.TextEditor | undefined
	private overlays: DiffOverlay[] = []
	private colorScheme: "vscode" | "custom" | "high-contrast" = "vscode"
	private currentDecorationType: vscode.TextEditorDecorationType | undefined

	constructor() {
		// Register event listeners
		DiffEventManager.onUiRefreshNeeded(this.onUiRefreshNeeded.bind(this))
	}

	/**
	 * Initialize renderer
	 */
	initialize(editor: vscode.TextEditor): void {
		this.activeEditor = editor
		Logger.debug("DiffRenderer.initialize", "Renderer initialized")
	}

	/**
	 * Set color scheme
	 */
	setColorScheme(scheme: "vscode" | "custom" | "high-contrast"): void {
		this.colorScheme = scheme
		this.render(this.overlays) // Re-render with new color scheme
	}

	/**
	 * Render overlays
	 */
	render(overlays: DiffOverlay[]): void {
		try {
			this.overlays = overlays

			if (!this.activeEditor) {
				Logger.warn("DiffRenderer.render", "No active editor available")
				return
			}

			// Dispose previous decoration type
			if (this.currentDecorationType) {
				this.currentDecorationType.dispose()
			}

			// Create new decoration type
			this.currentDecorationType = vscode.window.createTextEditorDecorationType({})

			const decorations = this.createDecorations(overlays)
			this.activeEditor.setDecorations(this.currentDecorationType, decorations)

			Logger.debug("DiffRenderer.render", `Rendered ${overlays.length} overlays`)
		} catch (error) {
			Logger.error("DiffRenderer.render", "Failed to render overlays", error)
		}
	}

	/**
	 * Clear all decorations
	 */
	clear(): void {
		try {
			if (this.currentDecorationType) {
				this.currentDecorationType.dispose()
				this.currentDecorationType = undefined
			}

			this.overlays = []
			Logger.debug("DiffRenderer.clear", "Cleared all decorations")
		} catch (error) {
			Logger.error("DiffRenderer.clear", "Failed to clear decorations", error)
		}
	}

	/**
	 * Update overlay at specific line
	 */
	updateOverlay(overlayId: string, overlay: DiffOverlay): void {
		try {
			const index = this.overlays.findIndex((o) => o.id === overlayId)
			if (index !== -1) {
				this.overlays[index] = overlay
				this.render(this.overlays)
			}
		} catch (error) {
			Logger.error("DiffRenderer.updateOverlay", "Failed to update overlay", error)
		}
	}

	/**
	 * Get overlay at position
	 */
	getOverlayAt(position: vscode.Position): DiffOverlay | undefined {
		const line = position.line
		return this.overlays.find((overlay) => line >= overlay.startLine && line <= overlay.endLine)
	}

	/**
	 * Get all overlays
	 */
	getOverlays(): DiffOverlay[] {
		return [...this.overlays]
	}

	/**
	 * Create VSCode decorations from overlays
	 */
	private createDecorations(overlays: DiffOverlay[]): vscode.DecorationOptions[] {
		const decorations: vscode.DecorationOptions[] = []

		for (const overlay of overlays) {
			const decoration = this.createDecoration(overlay)
			if (decoration) {
				decorations.push(decoration)
			}
		}

		return decorations
	}

	/**
	 * Create decoration for single overlay
	 */
	private createDecoration(overlay: DiffOverlay): vscode.DecorationOptions | null {
		try {
			const range = new vscode.Range(overlay.startLine, 0, overlay.endLine, 0)

			const colors = this.getColorScheme(overlay.type)
			let hoverMessage: string

			// Base styling based on type
			if (overlay.type === "addition") {
				hoverMessage = `+ Addition: ${overlay.content.substring(0, 50)}${overlay.content.length > 50 ? "..." : ""}`
			} else if (overlay.type === "deletion") {
				hoverMessage = `- Deletion: ${overlay.content.substring(0, 50)}${overlay.content.length > 50 ? "..." : ""}`
			} else if (overlay.type === "modification") {
				hoverMessage = `~ Modification: ${overlay.content.substring(0, 50)}${overlay.content.length > 50 ? "..." : ""}`
			} else {
				return null
			}

			// Adjust message based on acceptance state
			if (overlay.isAccepted) {
				hoverMessage += " (Accepted)"
			} else if (overlay.isRejected) {
				hoverMessage += " (Rejected)"
			}

			return {
				range,
				hoverMessage,
			}
		} catch (error) {
			Logger.error("DiffRenderer.createDecoration", "Failed to create decoration", error)
			return null
		}
	}

	/**
	 * Get colors for overlay type based on current scheme
	 */
	private getColorScheme(type: "addition" | "deletion" | "modification"): {
		backgroundColor: string
		borderColor: string
		textColor: string
	} {
		if (this.colorScheme === "vscode") {
			return this.getVSCodeColors(type)
		} else if (this.colorScheme === "high-contrast") {
			return this.getHighContrastColors(type)
		} else {
			return this.getCustomColors(type)
		}
	}

	/**
	 * Get VSCode theme colors
	 */
	private getVSCodeColors(type: "addition" | "deletion" | "modification"): {
		backgroundColor: string
		borderColor: string
		textColor: string
	} {
		switch (type) {
			case "addition":
				return {
					backgroundColor: "rgba(0, 255, 0, 0.1)",
					borderColor: "rgba(0, 255, 0, 0.3)",
					textColor: "#00ff00",
				}
			case "deletion":
				return {
					backgroundColor: "rgba(255, 0, 0, 0.1)",
					borderColor: "rgba(255, 0, 0, 0.3)",
					textColor: "#ff0000",
				}
			case "modification":
				return {
					backgroundColor: "rgba(255, 255, 0, 0.1)",
					borderColor: "rgba(255, 255, 0, 0.3)",
					textColor: "#ffff00",
				}
			default:
				return {
					backgroundColor: "rgba(128, 128, 128, 0.1)",
					borderColor: "rgba(128, 128, 128, 0.3)",
					textColor: "#808080",
				}
		}
	}

	/**
	 * Get high contrast colors
	 */
	private getHighContrastColors(type: "addition" | "deletion" | "modification"): {
		backgroundColor: string
		borderColor: string
		textColor: string
	} {
		switch (type) {
			case "addition":
				return {
					backgroundColor: "rgba(0, 128, 0, 0.2)",
					borderColor: "rgba(0, 255, 0, 1)",
					textColor: "#00ff80",
				}
			case "deletion":
				return {
					backgroundColor: "rgba(128, 0, 0, 0.2)",
					borderColor: "rgba(255, 0, 0, 1)",
					textColor: "#ff0080",
				}
			case "modification":
				return {
					backgroundColor: "rgba(128, 128, 0, 0.2)",
					borderColor: "rgba(255, 255, 0, 1)",
					textColor: "#ffff80",
				}
			default:
				return {
					backgroundColor: "rgba(64, 64, 64, 0.2)",
					borderColor: "rgba(255, 255, 255, 1)",
					textColor: "#c0c0c0",
				}
		}
	}

	/**
	 * Get custom colors
	 */
	private getCustomColors(type: "addition" | "deletion" | "modification"): {
		backgroundColor: string
		borderColor: string
		textColor: string
	} {
		switch (type) {
			case "addition":
				return {
					backgroundColor: "rgba(46, 125, 50, 0.15)",
					borderColor: "rgba(46, 125, 50, 0.8)",
					textColor: "#2e7d32",
				}
			case "deletion":
				return {
					backgroundColor: "rgba(220, 38, 127, 0.15)",
					borderColor: "rgba(220, 38, 127, 0.8)",
					textColor: "#dc267f",
				}
			case "modification":
				return {
					backgroundColor: "rgba(251, 146, 60, 0.15)",
					borderColor: "rgba(251, 146, 60, 0.8)",
					textColor: "#fb923c",
				}
			default:
				return {
					backgroundColor: "rgba(108, 117, 125, 0.15)",
					borderColor: "rgba(108, 117, 125, 0.8)",
					textColor: "#6c757d",
				}
		}
	}

	/**
	 * Adjust color brightness
	 */
	private adjustColorBrightness(color: string, factor: number): string {
		// Simple brightness adjustment for hex colors
		if (color.startsWith("#")) {
			const hex = color.slice(1)
			const num = parseInt(hex, 16)
			const r = (num >> 16) & 255
			const g = (num >> 8) & 255
			const b = num & 255

			const adjustBrightness = (value: number) => {
				const adjusted = Math.round(value + (255 - value) * factor)
				return Math.max(0, Math.min(255, adjusted))
			}

			const newR = adjustBrightness(r)
			const newG = adjustBrightness(g)
			const newB = adjustBrightness(b)

			return `#${((newR << 16) | (newG << 8) | newB).toString(16).padStart(6, "0")}`
		}

		return color // Return original for rgba colors
	}

	/**
	 * Handle UI refresh needed event
	 */
	private onUiRefreshNeeded(event: any): void {
		if (event.data.reason === "color-scheme-changed") {
			this.render(this.overlays)
		}
	}
}
