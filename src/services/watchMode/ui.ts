import * as vscode from "vscode"
import { EXPERIMENT_IDS, ExperimentId, experiments } from "../../shared/experiments"

/**
 * UI manager for the Watch Mode service
 * Handles status bar items and notifications
 */
export class WatchModeStatusBar {
	private statusBarItem: vscode.StatusBarItem
	private processingStatusBarItem: vscode.StatusBarItem
	private isExperimentEnabled: boolean

	/**
	 * Creates a new instance of the WatchModeUI
	 * @param context The extension context
	 */
	constructor(private readonly context: vscode.ExtensionContext) {
		this.isExperimentEnabled = this.checkExperimentEnabled()

		// Create status bar item to show watch mode status
		this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
		this.statusBarItem.name = "Kilo Code Watch Mode"
		// Remove command since toggle functionality was removed
		this.statusBarItem.command = undefined

		// Create status bar item to show processing status
		this.processingStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
		this.processingStatusBarItem.name = "Kilo Code Watch Mode Processing"

		// Register the status bar items for disposal
		this.context.subscriptions.push(this.statusBarItem)
		this.context.subscriptions.push(this.processingStatusBarItem)

		// Update UI visibility based on experiment flag
		this.updateVisibility()
	}

	/**
	 * Checks if the watch mode experiment is enabled
	 */
	private checkExperimentEnabled(): boolean {
		const experimentsConfig = (this.context.globalState.get("experiments") || {}) as Record<ExperimentId, boolean>
		return experiments.isEnabled(experimentsConfig, EXPERIMENT_IDS.WATCH_MODE)
	}

	/**
	 * Updates the visibility of UI elements based on experiment flag
	 */
	private updateVisibility(): void {
		if (!this.isExperimentEnabled) {
			this.hideAll()
			return
		}
	}

	/**
	 * Shows the status bar item with the active state
	 * @param isActive Whether watch mode is active
	 */
	public showStatus(isActive: boolean): void {
		if (!this.isExperimentEnabled) {
			return
		}

		if (isActive) {
			this.statusBarItem.text = "$(eye) Watch Mode"
			this.statusBarItem.tooltip = "Kilo Code Watch Mode is active. Click to disable."
			this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground")
		} else {
			this.statusBarItem.text = "$(eye-closed) Watch Mode"
			this.statusBarItem.tooltip = "Kilo Code Watch Mode is disabled. Click to enable."
			this.statusBarItem.backgroundColor = undefined
		}

		this.statusBarItem.show()
	}

	/**
	 * Shows the processing status bar item
	 * @param fileCount Number of files being processed
	 */
	public showProcessing(fileCount: number = 1): void {
		if (!this.isExperimentEnabled) {
			return
		}

		this.processingStatusBarItem.text = `$(sync~spin) Processing comments${fileCount > 1 ? ` (${fileCount})` : ""}`
		this.processingStatusBarItem.tooltip = "Kilo Code is processing comments in your files"
		this.processingStatusBarItem.show()
	}

	/**
	 * Hides the processing status bar item
	 */
	public hideProcessing(): void {
		this.processingStatusBarItem.hide()
	}

	/**
	 * Hides all UI elements
	 */
	public hideAll(): void {
		this.statusBarItem.hide()
		this.processingStatusBarItem.hide()
	}

	/**
	 * Shows a success notification for processed comments
	 * @param filePath Path of the file that was processed
	 * @param commentCount Number of comments processed
	 */
	public showSuccessNotification(filePath: string, commentCount: number): void {
		if (!this.isExperimentEnabled) {
			return
		}

		const fileName = filePath.split("/").pop() || filePath

		vscode.window.showInformationMessage(
			`Watch Mode: Processed ${commentCount} comment${commentCount !== 1 ? "s" : ""} in ${fileName}`,
			{ modal: false },
		)
	}

	/**
	 * Shows an error notification
	 * @param message The error message
	 */
	public showErrorNotification(message: string): void {
		if (!this.isExperimentEnabled) {
			return
		}

		vscode.window.showErrorMessage(`Watch Mode Error: ${message}`, { modal: false })
	}

	/**
	 * Updates the experiment enabled state
	 */
	public refreshExperimentState(): void {
		this.isExperimentEnabled = this.checkExperimentEnabled()
		this.updateVisibility()
	}

	/**
	 * Disposes the UI components
	 */
	public dispose(): void {
		this.statusBarItem.dispose()
		this.processingStatusBarItem.dispose()
	}
}
