// kilocode_change - new file
import { Loader2, XCircle } from "lucide-react"
import { Button, Progress } from "@/components/ui"

interface BenchProgressData {
	phase: string
	currentModel?: string
	currentProblem?: number
	totalProblems?: number
	modelsCompleted?: number
	totalModels?: number
	message?: string
}

interface BenchProgressProps {
	progress: BenchProgressData
	onCancel: () => void
}

export function BenchProgressView({ progress, onCancel }: BenchProgressProps) {
	const isError = progress.phase === "error"
	const isRunning = progress.phase === "running"
	const isGenerating = progress.phase === "generating"
	const isEvaluating = progress.phase === "evaluating"

	// Calculate overall progress percentage
	let progressPercent = 0
	if (isGenerating) {
		progressPercent = 10
	} else if (isRunning && progress.totalModels && progress.totalProblems) {
		const totalWork = progress.totalModels * progress.totalProblems
		const doneWork = (progress.modelsCompleted || 0) * progress.totalProblems + (progress.currentProblem || 0)
		// Running phase occupies 10-80%
		progressPercent = 10 + (doneWork / totalWork) * 70
	} else if (isEvaluating) {
		progressPercent = 85
	}

	return (
		<div className="flex flex-col items-center justify-center h-full gap-5 px-6">
			{/* Spinner or error icon */}
			{isError ? (
				<XCircle className="w-8 h-8 text-vscode-errorForeground" />
			) : (
				<Loader2 className="w-8 h-8 text-vscode-foreground animate-spin" />
			)}

			{/* Phase label */}
			<div className="text-center space-y-1">
				<div className="text-sm font-medium text-vscode-foreground">
					{isGenerating && "Generating Problems"}
					{isRunning && "Running Benchmark"}
					{isEvaluating && "Evaluating Results"}
					{isError && "Error"}
				</div>
				{progress.message && (
					<div className="text-xs text-vscode-descriptionForeground max-w-sm">{progress.message}</div>
				)}
			</div>

			{/* Progress bar */}
			{!isError && (
				<div className="w-full max-w-xs space-y-1.5">
					<Progress value={progressPercent} className="h-1.5" />
					<div className="flex justify-between text-[10px] text-vscode-descriptionForeground">
						{isRunning && progress.currentModel && (
							<span className="truncate max-w-[200px]">{progress.currentModel}</span>
						)}
						{isRunning && progress.totalModels && (
							<span>
								Model {(progress.modelsCompleted || 0) + 1}/{progress.totalModels}
							</span>
						)}
					</div>
				</div>
			)}

			{/* Cancel button */}
			<Button variant="secondary" size="sm" onClick={onCancel} className="mt-2">
				{isError ? "Back" : "Cancel"}
			</Button>
		</div>
	)
}
