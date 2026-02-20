// kilocode_change - new file
import { BarChart3 } from "lucide-react"
import { Button } from "@/components/ui"

interface BenchEmptyStateProps {
	onStartBenchmark: () => void
}

export function BenchEmptyState({ onStartBenchmark }: BenchEmptyStateProps) {
	return (
		<div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
			<div className="flex items-center justify-center w-12 h-12 rounded-lg bg-vscode-badge-background">
				<BarChart3 className="w-6 h-6 text-vscode-badge-foreground" />
			</div>
			<div className="space-y-2">
				<h3 className="text-base font-semibold text-vscode-foreground">Benchmark Your Models</h3>
				<p className="text-sm text-vscode-descriptionForeground max-w-xs">
					Test AI models against your codebase across all 5 Kilo modes. Auto-generates problems, runs each
					model, and scores results with an AI judge.
				</p>
			</div>
			<div className="space-y-1.5 text-xs text-vscode-descriptionForeground max-w-xs text-left">
				<div className="flex items-start gap-2">
					<span className="text-vscode-foreground font-medium shrink-0">1.</span>
					<span>Select models to benchmark</span>
				</div>
				<div className="flex items-start gap-2">
					<span className="text-vscode-foreground font-medium shrink-0">2.</span>
					<span>Problems are auto-generated from your workspace</span>
				</div>
				<div className="flex items-start gap-2">
					<span className="text-vscode-foreground font-medium shrink-0">3.</span>
					<span>Each model runs every problem using real Kilo mode prompts</span>
				</div>
				<div className="flex items-start gap-2">
					<span className="text-vscode-foreground font-medium shrink-0">4.</span>
					<span>An AI judge scores quality, relevance, speed, and cost</span>
				</div>
			</div>
			<Button variant="primary" className="mt-2" onClick={onStartBenchmark}>
				Run Benchmark
			</Button>
		</div>
	)
}
