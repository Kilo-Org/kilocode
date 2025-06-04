import * as vscode from "vscode"
import { VisualizationType } from "./VisualizationType"
import { AutocompleteVisualizationResponse } from "./types/VisualizationData"

/**
 * Abstract base class for all visualization types
 * Provides common functionality and state management
 */
export abstract class BaseVisualization implements VisualizationType {
	/**
	 * Unique identifier for this visualization type
	 */
	abstract readonly id: string

	/**
	 * Display name for this visualization type
	 */
	abstract readonly name: string

	/**
	 * Description of what this visualization shows
	 */
	abstract readonly description: string

	/**
	 * Whether this visualization is currently active
	 */
	protected isActive: boolean = false

	/**
	 * Disposables for this visualization
	 */
	protected disposables: vscode.Disposable[] = []

	/**
	 * Activate this visualization
	 */
	public async activate(): Promise<void> {
		if (this.isActive) return

		this.isActive = true
		await this.onActivate()
	}

	/**
	 * Deactivate this visualization
	 */
	public async deactivate(): Promise<void> {
		if (!this.isActive) return

		this.isActive = false
		await this.onDeactivate()
	}

	/**
	 * Update the visualization based on the current document and position
	 */
	public async update(
		document: vscode.TextDocument,
		position: vscode.Position,
		editor?: vscode.TextEditor,
	): Promise<void> {
		if (!this.isActive) return

		await this.onUpdate(document, position, editor)
	}

	/**
	 * Handle a response from the model containing visualization data
	 */
	public async handleResponse(response: AutocompleteVisualizationResponse): Promise<void> {
		if (!this.isActive) return

		await this.onHandleResponse(response)
	}

	/**
	 * Clean up resources used by this visualization
	 */
	public dispose(): void {
		this.isActive = false
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
		this.onDispose()
	}

	/**
	 * Called when the visualization is activated
	 */
	protected abstract onActivate(): Promise<void>

	/**
	 * Called when the visualization is deactivated
	 */
	protected abstract onDeactivate(): Promise<void>

	/**
	 * Called when the visualization should update based on the current document and position
	 */
	protected abstract onUpdate(
		document: vscode.TextDocument,
		position: vscode.Position,
		editor?: vscode.TextEditor,
	): Promise<void>

	/**
	 * Called when a response is received from the model
	 */
	protected abstract onHandleResponse(response: AutocompleteVisualizationResponse): Promise<void>

	/**
	 * Called when the visualization is being disposed
	 */
	protected abstract onDispose(): void
}
