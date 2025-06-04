import * as vscode from "vscode"
import { AutocompleteVisualizationResponse } from "./types/VisualizationData"

/**
 * Interface for all visualization types
 * Each visualization type is responsible for displaying a specific type of prediction
 */
export interface VisualizationType {
	/**
	 * Unique identifier for this visualization type
	 */
	readonly id: string

	/**
	 * Display name for this visualization type
	 */
	readonly name: string

	/**
	 * Description of what this visualization shows
	 */
	readonly description: string

	/**
	 * Activate this visualization
	 */
	activate(): Promise<void>

	/**
	 * Deactivate this visualization
	 */
	deactivate(): Promise<void>

	/**
	 * Update the visualization based on the current document and position
	 */
	update(document: vscode.TextDocument, position: vscode.Position, editor?: vscode.TextEditor): Promise<void>

	/**
	 * Handle a response from the model containing visualization data
	 */
	handleResponse(response: AutocompleteVisualizationResponse): Promise<void>

	/**
	 * Clean up resources used by this visualization
	 */
	dispose(): void
}
