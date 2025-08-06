import * as vscode from "vscode"

export const UI_SHOW_LOADING_DELAY_MS = 150

/**
 * Manages the animated decoration for ghost suggestions loading indicator
 */
export class GhostDecorationAnimation {
	private animationInitialWaitTimer: NodeJS.Timeout | null = null
	private animationInterval: NodeJS.Timeout | null = null
	private decorationType: vscode.TextEditorDecorationType
	private animationState = 0
	private isTypingPhase = true // Track whether we're in typing phase or blinking phase
	private readonly animationFrames = ["█", "K█", "KI█", "KIL█", "KILO█"]
	private isBlockVisible = true // For blinking effect when fully spelled
	private editor: vscode.TextEditor | null = null
	private range: vscode.Range | null = null

	public constructor() {
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
	 */
	public startAnimation(): void {
		const editor = vscode.window.activeTextEditor
		if (!editor) return

		this.stopAnimation() // Stop any existing animation

		const position = editor.selection.active
		const document = editor.document
		const lineEndPosition = new vscode.Position(position.line, document.lineAt(position.line).text.length)

		this.editor = editor
		this.range = new vscode.Range(lineEndPosition, lineEndPosition)
		this.animationState = 0
		this.isTypingPhase = true // Reset to typing phase
		this.isBlockVisible = true

		// Delay starting the animation slightly to not distract users
		// We're still fetching the completion, this just delays showing the decorator.
		this.animationInitialWaitTimer = setTimeout(() => {
			// Apply initial animation state
			this.updateDecorationText()

			// Start animation interval
			this.animationInterval = setInterval(() => {
				this.updateAnimation()
			}, 100)
		}, UI_SHOW_LOADING_DELAY_MS)
	}

	/**
	 * Stops the loading animation and immediately hides the decorator
	 */
	public stopAnimation(): void {
		// Clear animation immediately
		if (this.animationInterval) {
			clearInterval(this.animationInterval)
			this.animationInterval = null
		}

		if (this.animationInitialWaitTimer) {
			clearTimeout(this.animationInitialWaitTimer)
		}

		if (this.editor && this.decorationType) {
			this.editor.setDecorations(this.decorationType, [])
		}

		this.editor = null
		this.range = null
	}

	/**
	 * Updates the animation state and decoration text
	 */
	private updateAnimation(): void {
		if (!this.editor || !this.range) {
			this.stopAnimation()
			return
		}

		// Animation with two phases:
		// 1. Typing out "KILO" (block moves to the right) - faster (100ms)
		// 2. Blinking block at the end when fully spelled - slower (200ms)
		if (this.animationState < this.animationFrames.length - 1) {
			// Phase 1: Spell out "KILO" with block cursor
			this.animationState++
		} else {
			// Check if we just reached the end of typing phase
			if (this.isTypingPhase) {
				// Transition from typing to blinking phase
				this.isTypingPhase = false

				// Clear current interval and create a new one with slower timing (200ms)
				if (this.animationInterval) {
					clearInterval(this.animationInterval)
				}

				this.animationInterval = setInterval(() => {
					this.updateAnimation()
				}, 200)
			}

			// Phase 2: Blink the block cursor at the end
			this.isBlockVisible = !this.isBlockVisible
		}

		this.updateDecorationText()
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
