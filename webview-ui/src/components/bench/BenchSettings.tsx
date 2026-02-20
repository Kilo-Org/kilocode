// kilocode_change - new file
import { useState, useEffect } from "react"
import { Settings } from "lucide-react"
import { Button, Slider } from "@/components/ui"
import { Checkbox } from "@/components/ui"
import { vscode } from "@src/utils/vscode"
import type { ExtensionMessage } from "@roo-code/types"

interface BenchConfig {
	problemsPerMode: number
	activeModes: string[]
	generatorModel: string
	evaluatorModel: string
	maxParallelModels: number
	temperature: number
	weights: {
		quality: number
		relevance: number
		speed: number
		cost: number
	}
}

const ALL_MODES = ["architect", "code", "debug", "ask", "orchestrator"]

const MODE_LABELS: Record<string, string> = {
	architect: "Architect",
	code: "Code",
	debug: "Debug",
	ask: "Ask",
	orchestrator: "Orchestrator",
}

interface BenchSettingsProps {
	onClose: () => void
}

export function BenchSettings({ onClose }: BenchSettingsProps) {
	const [config, setConfig] = useState<BenchConfig | null>(null)

	// Load config on mount
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data
			if (message.type === "benchConfig" && message.benchConfig) {
				setConfig(message.benchConfig)
			}
		}
		window.addEventListener("message", handler)
		vscode.postMessage({ type: "benchLoadResults" })
		return () => window.removeEventListener("message", handler)
	}, [])

	const updateConfig = (updates: Partial<BenchConfig>) => {
		if (!config) return
		const newConfig = { ...config, ...updates }
		setConfig(newConfig)
		vscode.postMessage({ type: "benchUpdateConfig", benchConfig: updates })
	}

	const toggleMode = (mode: string) => {
		if (!config) return
		const modes = config.activeModes.includes(mode)
			? config.activeModes.filter((m) => m !== mode)
			: [...config.activeModes, mode]
		updateConfig({ activeModes: modes })
	}

	if (!config) {
		return (
			<div className="flex items-center justify-center h-full text-xs text-vscode-descriptionForeground">
				Loading settings...
			</div>
		)
	}

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Settings className="w-4 h-4 text-vscode-foreground" />
					<h4 className="text-sm font-medium text-vscode-foreground">Bench Settings</h4>
				</div>
				<Button variant="ghost" size="sm" onClick={onClose}>
					Done
				</Button>
			</div>

			{/* Problems per mode */}
			<div className="space-y-2">
				<label className="text-xs font-medium text-vscode-foreground">
					Problems per Mode: {config.problemsPerMode}
				</label>
				<Slider
					min={1}
					max={5}
					step={1}
					value={[config.problemsPerMode]}
					onValueChange={([v]) => updateConfig({ problemsPerMode: v })}
				/>
			</div>

			{/* Active modes */}
			<div className="space-y-2">
				<label className="text-xs font-medium text-vscode-foreground">Active Modes</label>
				<div className="space-y-1.5">
					{ALL_MODES.map((mode) => (
						<label key={mode} className="flex items-center gap-2 cursor-pointer">
							<Checkbox
								checked={config.activeModes.includes(mode)}
								onCheckedChange={() => toggleMode(mode)}
							/>
							<span className="text-xs text-vscode-foreground">{MODE_LABELS[mode]}</span>
						</label>
					))}
				</div>
			</div>

			{/* Scoring weights */}
			<div className="space-y-2">
				<label className="text-xs font-medium text-vscode-foreground">Scoring Weights</label>
				<div className="space-y-2">
					{(["quality", "relevance", "speed", "cost"] as const).map((key) => (
						<div key={key} className="space-y-1">
							<div className="flex justify-between text-[10px] text-vscode-descriptionForeground">
								<span className="capitalize">{key}</span>
								<span>{(config.weights[key] * 100).toFixed(0)}%</span>
							</div>
							<Slider
								min={0}
								max={100}
								step={5}
								value={[config.weights[key] * 100]}
								onValueChange={([v]) =>
									updateConfig({
										weights: { ...config.weights, [key]: v / 100 },
									})
								}
							/>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}
