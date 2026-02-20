// kilocode_change - new file
import { useState, useMemo } from "react"
import { Play, Search } from "lucide-react"
import { Button, Checkbox, Input } from "@/components/ui"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderModels } from "../kilocode/hooks/useProviderModels"

interface BenchModelSelectorProps {
	onRunBenchmark: (selectedModels: string[]) => void
	onCancel: () => void
}

export function BenchModelSelector({ onRunBenchmark, onCancel }: BenchModelSelectorProps) {
	const { apiConfiguration } = useExtensionState()
	const { providerModels, providerDefaultModel, isLoading } = useProviderModels(apiConfiguration)

	const [selectedModels, setSelectedModels] = useState<Set<string>>(() => {
		// Pre-select the current default model
		return providerDefaultModel ? new Set([providerDefaultModel]) : new Set()
	})
	const [searchQuery, setSearchQuery] = useState("")

	const modelIds = useMemo(() => {
		if (!providerModels) return []
		return Object.keys(providerModels).sort()
	}, [providerModels])

	const filteredModelIds = useMemo(() => {
		if (!searchQuery) return modelIds
		const query = searchQuery.toLowerCase()
		return modelIds.filter((id) => id.toLowerCase().includes(query))
	}, [modelIds, searchQuery])

	const toggleModel = (modelId: string) => {
		setSelectedModels((prev) => {
			const next = new Set(prev)
			if (next.has(modelId)) {
				next.delete(modelId)
			} else {
				next.add(modelId)
			}
			return next
		})
	}

	const selectAll = () => {
		setSelectedModels(new Set(filteredModelIds))
	}

	const selectNone = () => {
		setSelectedModels(new Set())
	}

	return (
		<div className="flex flex-col h-full gap-4">
			<div className="space-y-1">
				<h4 className="text-sm font-medium text-vscode-foreground">Select Models to Benchmark</h4>
				<p className="text-xs text-vscode-descriptionForeground">
					Choose which models to test against your codebase. Each selected model will run through all
					generated problems.
				</p>
			</div>

			{/* Search and bulk actions */}
			<div className="flex items-center gap-2">
				<div className="relative flex-1">
					<Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-vscode-descriptionForeground" />
					<Input
						placeholder="Filter models..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="pl-7 h-7 text-xs"
					/>
				</div>
				<Button variant="ghost" size="sm" onClick={selectAll} className="text-xs h-7 px-2">
					All
				</Button>
				<Button variant="ghost" size="sm" onClick={selectNone} className="text-xs h-7 px-2">
					None
				</Button>
			</div>

			{/* Model list */}
			<div className="flex-1 overflow-y-auto border border-vscode-panel-border rounded-md">
				{isLoading ? (
					<div className="flex items-center justify-center h-full text-xs text-vscode-descriptionForeground p-4">
						Loading models...
					</div>
				) : filteredModelIds.length === 0 ? (
					<div className="flex items-center justify-center h-full text-xs text-vscode-descriptionForeground p-4">
						{searchQuery ? "No models match your search" : "No models available for this provider"}
					</div>
				) : (
					<div className="divide-y divide-vscode-panel-border">
						{filteredModelIds.map((modelId) => {
							const info = providerModels[modelId]
							const isSelected = selectedModels.has(modelId)
							return (
								<label
									key={modelId}
									className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-vscode-list-hoverBackground">
									<Checkbox checked={isSelected} onCheckedChange={() => toggleModel(modelId)} />
									<div className="flex-1 min-w-0">
										<div className="text-xs text-vscode-foreground truncate">{modelId}</div>
										{info && (
											<div className="flex items-center gap-2 text-[10px] text-vscode-descriptionForeground">
												{info.contextWindow && (
													<span>{(info.contextWindow / 1000).toFixed(0)}k ctx</span>
												)}
												{info.inputPrice != null && info.outputPrice != null && (
													<span>
														${info.inputPrice.toFixed(2)}/${info.outputPrice.toFixed(2)} per
														M tokens
													</span>
												)}
											</div>
										)}
									</div>
								</label>
							)
						})}
					</div>
				)}
			</div>

			{/* Footer */}
			<div className="flex items-center justify-between">
				<span className="text-xs text-vscode-descriptionForeground">
					{selectedModels.size} model{selectedModels.size !== 1 ? "s" : ""} selected
				</span>
				<div className="flex items-center gap-2">
					<Button variant="secondary" size="sm" onClick={onCancel}>
						Cancel
					</Button>
					<Button
						variant="primary"
						size="sm"
						onClick={() => onRunBenchmark(Array.from(selectedModels))}
						disabled={selectedModels.size === 0}>
						<Play className="w-3.5 h-3.5 mr-1.5" />
						Generate & Run
					</Button>
				</div>
			</div>
		</div>
	)
}
