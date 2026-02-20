// kilocode_change - new file
import { useState, useCallback, useEffect, useRef } from "react"
import { ArrowLeft, Settings } from "lucide-react"
import { Tab, TabHeader, TabContent } from "../common/Tab"
import { Button } from "@/components/ui"
import { BenchEmptyState } from "./BenchEmptyState"
import { BenchModelSelector } from "./BenchModelSelector"
import { BenchProgressView } from "./BenchProgress"
import { BenchDashboard } from "./BenchDashboard"
import { BenchSettings } from "./BenchSettings"
import { vscode } from "@src/utils/vscode"
import type { ExtensionMessage } from "@roo-code/types"

type BenchSubView = "empty" | "modelSelect" | "running" | "results" | "settings"

interface BenchViewProps {
	onDone: () => void
}

export default function BenchView({ onDone }: BenchViewProps) {
	const [subView, setSubView] = useState<BenchSubView>("empty")
	const [progress, setProgress] = useState<{ phase: string; message?: string } | null>(null)
	const [results, setResults] = useState<any>(null)
	// Track which view to return to when closing settings
	const returnFromSettings = useRef<BenchSubView>("empty")

	const handleStartBenchmark = useCallback(() => {
		setSubView("modelSelect")
	}, [])

	const handleRunBenchmark = useCallback((selectedModels: string[]) => {
		setSubView("running")
		vscode.postMessage({
			type: "benchStartRun",
			benchModels: selectedModels,
		})
	}, [])

	const handleCancelModelSelect = useCallback(() => {
		setSubView("empty")
	}, [])

	const handleNewBenchmark = useCallback(() => {
		setResults(null)
		setSubView("modelSelect")
	}, [])

	const handleOpenSettings = useCallback(() => {
		returnFromSettings.current = subView as BenchSubView
		setSubView("settings")
	}, [subView])

	const handleCloseSettings = useCallback(() => {
		setSubView(returnFromSettings.current)
	}, [])

	// Load previous results on mount
	useEffect(() => {
		vscode.postMessage({ type: "benchLoadResults" })
	}, [])

	// Listen for bench messages from extension
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data
			switch (message.type) {
				case "benchProgress":
					setProgress(message.benchProgress)
					break
				case "benchResults":
					setResults(message.benchResults)
					setSubView("results")
					break
				case "benchError":
					setProgress({ phase: "error", message: message.benchError })
					if (subView !== "running") {
						setSubView("running")
					}
					break
			}
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [subView])

	// Show settings gear in header for pre-run views
	const showSettingsGear = subView === "empty" || subView === "modelSelect"

	return (
		<Tab>
			<TabHeader className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="sm" onClick={onDone} className="px-1.5">
						<ArrowLeft className="w-4 h-4" />
					</Button>
					<h3 className="font-semibold text-sm text-vscode-foreground">Bench</h3>
				</div>
				{showSettingsGear && (
					<Button
						variant="ghost"
						size="sm"
						onClick={handleOpenSettings}
						className="px-1.5"
						title="Bench Settings">
						<Settings className="w-4 h-4" />
					</Button>
				)}
			</TabHeader>
			<TabContent>
				{subView === "empty" && <BenchEmptyState onStartBenchmark={handleStartBenchmark} />}
				{subView === "modelSelect" && (
					<BenchModelSelector onRunBenchmark={handleRunBenchmark} onCancel={handleCancelModelSelect} />
				)}
				{subView === "running" && (
					<BenchProgressView
						progress={progress || { phase: "generating", message: "Starting benchmark..." }}
						onCancel={() => {
							vscode.postMessage({ type: "benchCancelRun" })
							setSubView("empty")
						}}
					/>
				)}
				{subView === "results" && results && (
					<BenchDashboard result={results} onNewBenchmark={handleNewBenchmark} />
				)}
				{subView === "settings" && <BenchSettings onClose={handleCloseSettings} />}
			</TabContent>
		</Tab>
	)
}
