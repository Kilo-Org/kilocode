import * as vscode from "vscode"
import { ExperimentalAutocompleteVisualizer } from "./ExperimentalAutocompleteVisualizer"
import { CursorJumpVisualization } from "./visualizations/CursorJumpVisualization"
import { PredictedEditVisualization } from "./visualizations/PredictedEditVisualization"
import { RelatedFileVisualization } from "./visualizations/RelatedFileVisualization"

/**
 * Register experimental autocomplete visualizations
 */
export function registerExperimentalAutocomplete(context: vscode.ExtensionContext): void {
	try {
		// Get the visualizer instance
		const visualizer = ExperimentalAutocompleteVisualizer.getInstance()

		// Register commands
		context.subscriptions.push(
			vscode.commands.registerCommand("kilo-code.triggerExperimentalAutocomplete", () => visualizer.toggle()),

			vscode.commands.registerCommand("kilo-code.selectExperimentalVisualizations", () =>
				visualizer.showVisualizationPicker(),
			),
		)

		// Register visualizations
		const cursorJumpViz = new CursorJumpVisualization()
		const predictedEditViz = new PredictedEditVisualization()
		const relatedFileViz = new RelatedFileVisualization()

		visualizer.registerVisualization(cursorJumpViz)
		visualizer.registerVisualization(predictedEditViz)
		visualizer.registerVisualization(relatedFileViz)

		// Add visualizer to subscriptions for cleanup
		context.subscriptions.push(visualizer)

		console.log("🚀🔮 Kilo Code experimental autocomplete visualizations registered")
	} catch (error) {
		console.error("🚀🔮 Failed to register experimental autocomplete visualizations:", error)
	}
}
