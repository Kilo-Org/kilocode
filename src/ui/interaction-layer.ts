/**
 * Accept/Reject Interaction Layer
 *
 * Handles user interactions with diff overlays (accept, reject, navigation)
 */

import * as vscode from "vscode"
import { DiffOverlay } from "../types/diff-types"
import { Logger } from "../services/error-handler"
import { DiffEventManager } from "../services/event-system"

/**
 * Manages user interactions with diff overlays
 */
export class InteractionLayer {
	private activeEditor: vscode.TextEditor | undefined
	private overlays: DiffOverlay[] = []
	private commandRegistrations: vscode.Disposable[] = []
	private overlayStateUnsubscribe: (() => void) | null = null

	constructor() {
		// Register event listeners
		this.overlayStateUnsubscribe = DiffEventManager.onOverlayStateChanged(this.onOverlayStateChanged.bind(this))
	}

	/**
	 * Initialize interaction layer
	 */
	initialize(editor: vscode.TextEditor): void {
		this.activeEditor = editor
		this.registerCommands()
		this.setupKeyboardShortcuts()
		Logger.debug("InteractionLayer.initialize", "Interaction layer initialized")
	}

	/**
	 * Set overlays for interaction
	 */
	setOverlays(overlays: DiffOverlay[]): void {
		this.overlays = overlays
	}

	/**
	 * Register VSCode commands
	 */
	private registerCommands(): void {
		const commands = [
			vscode.commands.registerCommand("diff.acceptCurrent", () => this.acceptCurrentOverlay()),
			vscode.commands.registerCommand("diff.rejectCurrent", () => this.rejectCurrentOverlay()),
			vscode.commands.registerCommand("diff.acceptAll", () => this.acceptAllOverlays()),
			vscode.commands.registerCommand("diff.rejectAll", () => this.rejectAllOverlays()),
			vscode.commands.registerCommand("diff.nextOverlay", () => this.navigateToNextOverlay()),
			vscode.commands.registerCommand("diff.previousOverlay", () => this.navigateToPreviousOverlay()),
			vscode.commands.registerCommand("diff.gotoOverlay", () => this.showOverlayQuickPick()),
		]

		this.commandRegistrations.push(...commands)
	}

	/**
	 * Setup keyboard shortcuts
	 */
	private setupKeyboardShortcuts(): void {
		// This would typically be handled by VSCode keybindings
		// For now, we rely on command palette
	}

	/**
	 * Accept current overlay at cursor position
	 */
	acceptCurrentOverlay(): boolean {
		try {
			if (!this.activeEditor) {
				Logger.warn("InteractionLayer.acceptCurrentOverlay", "No active editor")
				return false
			}

			const position = this.activeEditor.selection.active
			const overlay = this.getOverlayAtPosition(position)

			if (overlay) {
				return this.acceptOverlay(overlay.id)
			}

			Logger.showUserInfo("No diff overlay found at cursor position")
			return false
		} catch (error) {
			Logger.error("InteractionLayer.acceptCurrentOverlay", "Failed to accept current overlay", error)
			return false
		}
	}

	/**
	 * Reject current overlay at cursor position
	 */
	rejectCurrentOverlay(): boolean {
		try {
			if (!this.activeEditor) {
				Logger.warn("InteractionLayer.rejectCurrentOverlay", "No active editor")
				return false
			}

			const position = this.activeEditor.selection.active
			const overlay = this.getOverlayAtPosition(position)

			if (overlay) {
				return this.rejectOverlay(overlay.id)
			}

			Logger.showUserInfo("No diff overlay found at cursor position")
			return false
		} catch (error) {
			Logger.error("InteractionLayer.rejectCurrentOverlay", "Failed to reject current overlay", error)
			return false
		}
	}

	/**
	 * Accept specific overlay
	 */
	acceptOverlay(overlayId: string): boolean {
		try {
			const overlay = this.overlays.find((o) => o.id === overlayId)
			if (!overlay) {
				Logger.warn("InteractionLayer.acceptOverlay", `Overlay ${overlayId} not found`)
				return false
			}

			if (overlay.isAccepted) {
				Logger.showUserInfo(`Overlay ${overlayId} is already accepted`)
				return true
			}

			// Update overlay state
			overlay.isAccepted = true
			overlay.isRejected = false

			// Emit event
			DiffEventManager.emitDiffAccepted({
				data: { overlayId },
				timestamp: new Date(),
			})

			// Trigger UI refresh
			DiffEventManager.emitUiRefreshNeeded("overlay-accepted")

			Logger.showUserInfo(`Accepted overlay ${overlayId}`)
			return true
		} catch (error) {
			Logger.error("InteractionLayer.acceptOverlay", "Failed to accept overlay", error)
			return false
		}
	}

	/**
	 * Reject specific overlay
	 */
	rejectOverlay(overlayId: string): boolean {
		try {
			const overlay = this.overlays.find((o) => o.id === overlayId)
			if (!overlay) {
				Logger.warn("InteractionLayer.rejectOverlay", `Overlay ${overlayId} not found`)
				return false
			}

			if (overlay.isRejected) {
				Logger.showUserInfo(`Overlay ${overlayId} is already rejected`)
				return true
			}

			// Update overlay state
			overlay.isAccepted = false
			overlay.isRejected = true

			// Emit event
			DiffEventManager.emitDiffRejected({
				data: { overlayId },
				timestamp: new Date(),
			})

			// Trigger UI refresh
			DiffEventManager.emitUiRefreshNeeded("overlay-rejected")

			Logger.showUserInfo(`Rejected overlay ${overlayId}`)
			return true
		} catch (error) {
			Logger.error("InteractionLayer.rejectOverlay", "Failed to reject overlay", error)
			return false
		}
	}

	/**
	 * Accept all overlays
	 */
	acceptAllOverlays(): number {
		try {
			const pendingOverlays = this.overlays.filter((o) => !o.isAccepted && !o.isRejected)
			let acceptedCount = 0

			for (const overlay of pendingOverlays) {
				if (this.acceptOverlay(overlay.id)) {
					acceptedCount++
				}
			}

			Logger.showUserInfo(`Accepted ${acceptedCount} overlays`)
			return acceptedCount
		} catch (error) {
			Logger.error("InteractionLayer.acceptAllOverlays", "Failed to accept all overlays", error)
			return 0
		}
	}

	/**
	 * Reject all overlays
	 */
	rejectAllOverlays(): number {
		try {
			const pendingOverlays = this.overlays.filter((o) => !o.isAccepted && !o.isRejected)
			let rejectedCount = 0

			for (const overlay of pendingOverlays) {
				if (this.rejectOverlay(overlay.id)) {
					rejectedCount++
				}
			}

			Logger.showUserInfo(`Rejected ${rejectedCount} overlays`)
			return rejectedCount
		} catch (error) {
			Logger.error("InteractionLayer.rejectAllOverlays", "Failed to reject all overlays", error)
			return 0
		}
	}

	/**
	 * Navigate to next overlay
	 */
	navigateToNextOverlay(): boolean {
		try {
			if (!this.activeEditor) {
				return false
			}

			const currentPosition = this.activeEditor.selection.active
			const overlays = this.getSortedOverlays()

			// Find next overlay after current position
			const nextOverlay = overlays.find((overlay) => overlay.startLine > currentPosition.line)

			if (nextOverlay) {
				this.navigateToOverlay(nextOverlay)
				return true
			}

			Logger.showUserInfo("No more overlays after current position")
			return false
		} catch (error) {
			Logger.error("InteractionLayer.navigateToNextOverlay", "Failed to navigate to next overlay", error)
			return false
		}
	}

	/**
	 * Navigate to previous overlay
	 */
	navigateToPreviousOverlay(): boolean {
		try {
			if (!this.activeEditor) {
				return false
			}

			const currentPosition = this.activeEditor.selection.active
			const overlays = this.getSortedOverlays()

			// Find previous overlay before current position
			const previousOverlay = [...overlays].reverse().find((overlay) => overlay.endLine < currentPosition.line)

			if (previousOverlay) {
				this.navigateToOverlay(previousOverlay)
				return true
			}

			Logger.showUserInfo("No more overlays before current position")
			return false
		} catch (error) {
			Logger.error("InteractionLayer.navigateToPreviousOverlay", "Failed to navigate to previous overlay", error)
			return false
		}
	}

	/**
	 * Show overlay quick pick for navigation
	 */
	async showOverlayQuickPick(): Promise<void> {
		try {
			if (this.overlays.length === 0) {
				Logger.showUserInfo("No overlays available for navigation")
				return
			}

			const items = this.overlays.map((overlay) => ({
				label: this.getOverlayLabel(overlay),
				description: `Line ${overlay.startLine}${overlay.startLine !== overlay.endLine ? `-${overlay.endLine}` : ""} (${overlay.type})`,
				overlay,
			}))

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: "Select overlay to navigate to",
			})

			if (selected) {
				this.navigateToOverlay(selected.overlay)
			}
		} catch (error) {
			Logger.error("InteractionLayer.showOverlayQuickPick", "Failed to show overlay quick pick", error)
		}
	}

	/**
	 * Navigate to specific overlay
	 */
	private navigateToOverlay(overlay: DiffOverlay): void {
		if (!this.activeEditor) {
			return
		}

		// Move cursor to overlay start
		const position = new vscode.Position(overlay.startLine, 0)
		this.activeEditor.selection = new vscode.Selection(position, position)
		this.activeEditor.revealRange(
			new vscode.Range(overlay.startLine, 0, overlay.endLine, 0),
			vscode.TextEditorRevealType.InCenterIfOutsideViewport,
		)

		Logger.debug("InteractionLayer.navigateToOverlay", `Navigated to overlay ${overlay.id}`)
	}

	/**
	 * Get overlay at cursor position
	 */
	private getOverlayAtPosition(position: vscode.Position): DiffOverlay | undefined {
		return this.overlays.find((overlay) => position.line >= overlay.startLine && position.line <= overlay.endLine)
	}

	/**
	 * Get overlays sorted by line number
	 */
	private getSortedOverlays(): DiffOverlay[] {
		return [...this.overlays].sort((a, b) => a.startLine - b.startLine)
	}

	/**
	 * Get label for overlay display
	 */
	private getOverlayLabel(overlay: DiffOverlay): string {
		const status = overlay.isAccepted ? "✓ " : overlay.isRejected ? "✗ " : "○ "
		const type = overlay.type.charAt(0).toUpperCase() + overlay.type.slice(1)

		return `${status}${type} - Line ${overlay.startLine}${overlay.startLine !== overlay.endLine ? `-${overlay.endLine}` : ""}`
	}

	/**
	 * Handle overlay state changed event
	 */
	private onOverlayStateChanged(event: { fileBufferId: string; state: string }): void {
		Logger.debug(
			"InteractionLayer.onOverlayStateChanged",
			`Overlay state changed: ${event.fileBufferId} -> ${event.state}`,
		)
		// Refresh overlays if needed based on state change
	}

	/**
	 * Dispose interaction layer
	 */
	dispose(): void {
		// Dispose command registrations
		for (const registration of this.commandRegistrations) {
			registration.dispose()
		}

		// Unsubscribe from overlay state changes
		if (this.overlayStateUnsubscribe) {
			this.overlayStateUnsubscribe()
			this.overlayStateUnsubscribe = null
		}

		this.commandRegistrations = []
		this.overlays = []
		Logger.debug("InteractionLayer.dispose", "Interaction layer disposed")
	}
}
