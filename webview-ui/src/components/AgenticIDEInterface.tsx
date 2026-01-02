import React, { useState, useCallback, useEffect } from "react"
import { motion } from "framer-motion"
import {
	GhostTextProvider,
	useGhostTextEditor,
	SideBySideDiff,
	ContextVisualization,
	createContextItem,
	AgentActivityHUD,
	AgentStatusIndicator,
	useOdooPeekDefinitions,
} from "@/components/ui"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

// Simplified types for the demo
interface DemoFileChange {
	filePath: string
	type: "modified" | "added" | "deleted"
	status: "pending" | "accepted" | "rejected"
	hunks: Array<{
		oldStart: number
		oldLines: number
		newStart: number
		newLines: number
		lines: Array<{
			lineNumber: number
			type: "added" | "removed" | "unchanged"
			content: string
		}>
	}>
}

interface DemoContextItem {
	id: string
	type: "file" | "documentation" | "chat" | "jira" | "slack" | "workspace" | "symbol" | "definition"
	title: string
	subtitle?: string
	metadata?: Record<string, any>
	active?: boolean
	removable?: boolean
	onClick?: () => void
	onRemove?: () => void
}

interface DemoAgentThought {
	id: string
	agent: "planner" | "coder" | "verifier" | "orchestrator" | "researcher"
	type: "thinking" | "searching" | "coding" | "analyzing" | "verifying" | "completed" | "error"
	message: string
	timestamp: number
	metadata?: Record<string, any>
	duration?: number
}

// Example integration of all AI UI/UX components
export const AgenticIDEInterface: React.FC = () => {
	// Ghost text state
	const [editorText, setEditorText] = useState("function calculateSum(a, b) {")
	const [editorPosition, setEditorPosition] = useState({ line: 1, column: 35 })

	// Diff state
	const [fileChanges, setFileChanges] = useState<DemoFileChange[]>([
		{
			filePath: "models/res_partner.py",
			type: "modified",
			status: "pending",
			hunks: [
				{
					oldStart: 15,
					oldLines: 2,
					newStart: 15,
					newLines: 3,
					lines: [
						{ lineNumber: 15, type: "unchanged", content: "    name = fields.Char(" },
						{ lineNumber: 16, type: "removed", content: 'string="Name",' },
						{ lineNumber: 17, type: "added", content: 'string="Full Name",' },
						{ lineNumber: 18, type: "added", content: "required=True" },
						{ lineNumber: 19, type: "unchanged", content: "    )" },
					],
				},
			],
		},
		{
			filePath: "views/res_partner_views.xml",
			type: "modified",
			status: "pending",
			hunks: [
				{
					oldStart: 8,
					oldLines: 1,
					newStart: 8,
					newLines: 2,
					lines: [
						{ lineNumber: 8, type: "unchanged", content: '        <field name="name"/>' },
						{ lineNumber: 9, type: "added", content: '        <field name="phone"/>' },
					],
				},
			],
		},
	])

	// Context visualization state
	const [contextItems, setContextItems] = useState<DemoContextItem[]>([
		createContextItem("file", "models/res_partner.py", {
			subtitle: "Partner model",
			metadata: { lines: 245, size: "8.2KB" },
		}),
		createContextItem("documentation", "Odoo Field Types", {
			subtitle: "Official documentation",
			metadata: { source: "odoo.com", lastUpdated: "2024-01-15" },
		}),
		createContextItem("chat", "Previous discussion about fields", {
			subtitle: "2 hours ago",
			metadata: { messages: 12, duration: "5min" },
		}),
	])

	// Agent activity state
	const [agentThoughts, setAgentThoughts] = useState<DemoAgentThought[]>([
		{
			id: "1",
			agent: "planner",
			type: "thinking",
			message: "Analyzing Odoo model structure for partner fields...",
			timestamp: Date.now() - 5000,
			duration: 1200,
		},
		{
			id: "2",
			agent: "coder",
			type: "coding",
			message: "Adding required=True to name field for validation",
			timestamp: Date.now() - 3000,
			duration: 800,
		},
		{
			id: "3",
			agent: "verifier",
			type: "verifying",
			message: "Checking field compatibility with existing data",
			timestamp: Date.now() - 1000,
			duration: 600,
		},
	])

	const [isAgentActive, setIsAgentActive] = useState(true)
	const [currentAgent, setCurrentAgent] = useState("coder")

	// Odoo peek definitions
	const { showPeek, hidePeek, PeekComponent } = useOdooPeekDefinitions()

	// Ghost text integration
	const { handleKeyDown, handleTextChange } = useGhostTextEditor()

	// Simulate agent activity
	useEffect(() => {
		const interval = setInterval(() => {
			const agents = ["planner", "coder", "verifier", "orchestrator"] as const
			const types = ["thinking", "searching", "coding", "analyzing", "verifying"] as const
			const randomAgent = agents[Math.floor(Math.random() * agents.length)]
			const randomType = types[Math.floor(Math.random() * types.length)]

			const newThought: DemoAgentThought = {
				id: Date.now().toString(),
				agent: randomAgent,
				type: randomType,
				message: `Simulated ${randomAgent} activity: ${randomType}...`,
				timestamp: Date.now(),
				duration: Math.floor(Math.random() * 2000) + 500,
			}

			setAgentThoughts((prev) => [...prev.slice(-4), newThought])
			setCurrentAgent(randomAgent)
		}, 3000)

		return () => clearInterval(interval)
	}, [])

	const handleEditorChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const newText = e.target.value
			setEditorText(newText)
			handleTextChange(newText, editorPosition)
		},
		[handleTextChange, editorPosition],
	)

	const handleEditorKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			handleKeyDown(e as any, editorText, editorPosition)
		},
		[handleKeyDown, editorText, editorPosition],
	)

	const handleAcceptFile = useCallback((filePath: string) => {
		setFileChanges((prev) =>
			prev.map((change) => (change.filePath === filePath ? { ...change, status: "accepted" as const } : change)),
		)
	}, [])

	const handleRejectFile = useCallback((filePath: string) => {
		setFileChanges((prev) =>
			prev.map((change) => (change.filePath === filePath ? { ...change, status: "rejected" as const } : change)),
		)
	}, [])

	const handleAddContext = useCallback(() => {
		const newItem = createContextItem("workspace", "New context item", {
			subtitle: "Just added",
			metadata: { added: new Date().toISOString() },
		})
		setContextItems((prev) => [...prev, newItem])
	}, [])

	const handleRemoveContext = useCallback((id: string) => {
		setContextItems((prev) => prev.filter((item) => item.id !== id))
	}, [])

	return (
		<GhostTextProvider enabled={true}>
			<div className="min-h-screen bg-vscode-editor-background p-6">
				{/* Header with title and status */}
				<motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
					<div className="flex items-center justify-between">
						<div>
							<h1 className="text-2xl font-bold text-vscode-foreground mb-2">
								Kilo Code - Agentic IDE Interface
							</h1>
							<p className="text-vscode-descriptionForeground">
								Advanced AI UI/UX Layer with Windsurf Aesthetics
							</p>
						</div>

						<AgentStatusIndicator
							agents={[
								{
									name: "planner",
									status: isAgentActive ? "active" : "idle",
									currentTask: "Planning structure",
								},
								{
									name: "coder",
									status: currentAgent === "coder" ? "active" : "idle",
									currentTask: "Writing code",
									progress: 75,
								},
								{ name: "verifier", status: "idle" },
								{
									name: "orchestrator",
									status: isAgentActive ? "active" : "idle",
									currentTask: "Coordinating agents",
								},
							]}
						/>
					</div>
				</motion.div>

				{/* Main content grid */}
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
					{/* Editor Section */}
					<motion.div
						initial={{ opacity: 0, x: -20 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ delay: 0.1 }}
						className="space-y-4">
						<div className="ai-glass rounded-lg p-4">
							<h2 className="text-lg font-semibold text-vscode-foreground mb-3 flex items-center gap-2">
								<span>Code Editor with Ghost Text</span>
								<Badge variant="secondary" className="text-xs">
									AI-Powered
								</Badge>
							</h2>

							<textarea
								value={editorText}
								onChange={handleEditorChange}
								onKeyDown={handleEditorKeyDown}
								className="w-full h-32 p-3 bg-vscode-editor-background border border-vscode-border rounded-md font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-vscode-focusBorder"
								placeholder="Start typing to see AI suggestions..."
							/>

							<div className="mt-2 text-xs text-vscode-descriptionForeground">
								Press{" "}
								<kbd className="px-1 py-0.5 bg-vscode-toolbar-background border border-vscode-border rounded">
									Tab
								</kbd>{" "}
								to accept suggestions,
								<kbd className="px-1 py-0.5 bg-vscode-toolbar-background border border-vscode-border rounded ml-2">
									Escape
								</kbd>{" "}
								to dismiss
							</div>
						</div>

						{/* Context Visualization */}
						<div className="ai-glass rounded-lg p-4">
							<h2 className="text-lg font-semibold text-vscode-foreground mb-3">Active Context</h2>
							<ContextVisualization
								items={contextItems}
								onAddContext={handleAddContext}
								onClearAll={() => setContextItems([])}
								variant="chips"
								maxVisible={3}
							/>
						</div>
					</motion.div>

					{/* Diff and Activity Section */}
					<motion.div
						initial={{ opacity: 0, x: 20 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ delay: 0.2 }}
						className="space-y-4">
						{/* Side-by-side diff */}
						<div className="ai-glass rounded-lg p-4">
							<h2 className="text-lg font-semibold text-vscode-foreground mb-3 flex items-center gap-2">
								<span>Multi-File Diff Review</span>
								<Badge variant="outline" className="text-xs">
									{fileChanges.length} files
								</Badge>
							</h2>

							<SideBySideDiff
								changes={fileChanges}
								onAcceptFile={handleAcceptFile}
								onRejectFile={handleRejectFile}
								className="max-h-96"
							/>
						</div>
					</motion.div>
				</div>

				{/* Agent Activity HUD */}
				<AgentActivityHUD
					thoughts={agentThoughts}
					isActive={isAgentActive}
					currentAgent={currentAgent}
					position="bottom-right"
					showThoughts={true}
					compact={false}
				/>

				{/* Odoo Peek Definitions */}
				<PeekComponent />

				{/* Floating action buttons */}
				<motion.div
					initial={{ opacity: 0, scale: 0.8 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ delay: 0.3 }}
					className="fixed bottom-6 left-6 flex flex-col gap-2">
					<Button size="sm" onClick={() => setIsAgentActive(!isAgentActive)} className="ai-button-primary">
						{isAgentActive ? "Pause Agents" : "Resume Agents"}
					</Button>

					<Button
						size="sm"
						variant="outline"
						onClick={() => {
							// Simulate showing a peek definition
							showPeek(
								{ x: 200, y: 200 },
								{
									name: "name",
									type: "char",
									string: "Full Name",
									required: true,
									pythonDefinition: {
										className: "ResPartner",
										fieldName: "name",
										fieldType: "Char",
										lineNumber: 15,
										filePath: "models/res_partner.py",
									},
								},
								"field",
							)
						}}
						className="ai-button-secondary">
						Test Peek Definition
					</Button>
				</motion.div>
			</div>
		</GhostTextProvider>
	)
}

export default AgenticIDEInterface
