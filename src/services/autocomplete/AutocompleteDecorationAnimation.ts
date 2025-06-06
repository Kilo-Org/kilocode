import * as vscode from "vscode"
import { abortableDelay } from "./utils/abortableDelay"

export const UI_SHOW_LOADING_DELAY_MS = 150

/**
 * Manages the animated decoration for autocomplete loading indicator
 */
export class AutocompleteDecorationAnimation {
	private decorationType: vscode.TextEditorDecorationType
	private animationState = 0
	private isTypingPhase = true // Track whether we're in typing phase or blinking phase
	private readonly animationFrames = ["█", "K█", "KI█", "KIL█", "KILO█"]
	private isBlockVisible = true // For blinking effect when fully spelled
	private editor: vscode.TextEditor | null = null
	private range: vscode.Range | null = null
	private currentAbortController: AbortController | null = null

	constructor() {
		this.decorationType = vscode.window.createTextEditorDecorationType({
			after: {
				color: new vscode.ThemeColor("editorGhostText.foreground"),
				fontStyle: "italic",
				contentText: "⏳", // Initial state before animation starts
			},
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
		})
	}

	/**
	 * Starts the loading animation at the specified range in the editor
	 * @returns A function that stops this specific animation (no-op if superseded)
	 */
	public startAnimation(): () => void {
		const editor = vscode.window.activeTextEditor
		if (!editor) return () => {} // Return no-op function

		// Abort any existing animation
		if (this.currentAbortController) {
			this.currentAbortController.abort()
		}

		const position = editor.selection.active
		const document = editor.document
		const lineEndPosition = new vscode.Position(position.line, document.lineAt(position.line).text.length)

		this.editor = editor
		this.range = new vscode.Range(lineEndPosition, lineEndPosition)
		this.animationState = 0
		this.isTypingPhase = true // Reset to typing phase
		this.isBlockVisible = true

		// Create abort controller for this animation instance
		const abortController = new AbortController()
		this.currentAbortController = abortController

		// Start the animation asynchronously
		this.runAnimation(abortController)

		// Return scoped stop function for this specific animation
		return () => {
			// Only abort if this is still the current animation
			if (abortController === this.currentAbortController) {
				abortController.abort()
			}
		}
	}

	/**
	 * Runs the animation loop with proper cleanup using AbortController
	 */
	private async runAnimation(abortController: AbortController): Promise<void> {
		try {
			// Wait for initial delay
			await abortableDelay(UI_SHOW_LOADING_DELAY_MS, abortController.signal)

			// Apply initial animation state
			this.updateDecorationText()

			// Phase 1: Typing animation (100ms intervals)
			while (this.animationState < this.animationFrames.length - 1 && !abortController.signal.aborted) {
				await abortableDelay(100, abortController.signal)
				this.animationState++
				this.updateDecorationText()
			}

			// Transition to blinking phase
			this.isTypingPhase = false

			// Phase 2: Blinking animation (200ms intervals)
			while (!abortController.signal.aborted) {
				await abortableDelay(200, abortController.signal)
				this.isBlockVisible = !this.isBlockVisible
				this.updateDecorationText()
			}
		} catch (error) {
			// Animation was aborted - only clean up if this is still the current animation
			if (abortController === this.currentAbortController) {
				if (this.editor && this.decorationType) {
					this.editor.setDecorations(this.decorationType, [])
				}
				this.editor = null
				this.range = null
				this.currentAbortController = null
			}
		}
	}

	/**
	 * Stops the loading animation and immediately hides the decorator
	 */
	public stopAnimation(): void {
		if (this.currentAbortController) {
			this.currentAbortController.abort()
		}

		if (this.editor && this.decorationType) {
			this.editor.setDecorations(this.decorationType, [])
		}

		this.editor = null
		this.range = null
		this.currentAbortController = null
	}

	/**
	 * Updates the decoration text based on current animation state
	 */
	private updateDecorationText(): void {
		if (!this.editor || !this.range) return

		let text

		// When fully spelled and in blinking mode
		if (this.animationState === this.animationFrames.length - 1) {
			// Show either the full frame with block, or just "KILO" without block
			text = this.isBlockVisible ? this.animationFrames[this.animationState] : "KILO"
		} else {
			// Normal animation frames (with block)
			text = this.animationFrames[this.animationState]
		}

		// Update decoration type with new text
		const updatedDecorationType = vscode.window.createTextEditorDecorationType({
			after: {
				color: new vscode.ThemeColor("editorGhostText.foreground"),
				fontStyle: "italic",
				contentText: text,
			},
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
		})

		// Apply updated decoration
		this.editor.setDecorations(this.decorationType, [])
		this.decorationType = updatedDecorationType
		this.editor.setDecorations(this.decorationType, [this.range])
	}

	/**
	 * Disposes the decoration type and stops any active animation
	 */
	public dispose(): void {
		this.stopAnimation()
		this.decorationType?.dispose()
	}
}
