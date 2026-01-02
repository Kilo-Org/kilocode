import React, { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence, useAnimation } from "framer-motion"
import { Button } from "./button"
import { Badge } from "./badge"
import {
	Brain,
	Activity,
	ChevronDown,
	ChevronUp,
	EyeOff,
	Zap,
	Search,
	Code,
	CheckCircle,
	AlertCircle,
	Bot,
	Cpu,
	Database,
} from "lucide-react"
import { cn } from "@/lib/utils"

export interface AgentThought {
	id: string
	agent: "planner" | "coder" | "verifier" | "orchestrator" | "researcher"
	type: "thinking" | "searching" | "coding" | "analyzing" | "verifying" | "completed" | "error"
	message: string
	timestamp: number
	metadata?: Record<string, any>
	duration?: number
}

export interface AgentActivityHUDProps {
	thoughts: AgentThought[]
	isActive: boolean
	currentAgent?: string
	className?: string
	position?: "top-right" | "bottom-right" | "top-left" | "bottom-left"
	compact?: boolean
	showThoughts?: boolean
	onToggleThoughts?: () => void
}

export const AgentActivityHUD: React.FC<AgentActivityHUDProps> = ({
	thoughts,
	isActive,
	currentAgent,
	className,
	position = "top-right",
	compact = false,
	showThoughts = true,
	onToggleThoughts: _onToggleThoughts,
}) => {
	const [expanded, setExpanded] = useState(false)
	const [isMinimized, setIsMinimized] = useState(false)
	const pulseAnimation = useAnimation()
	const thoughtsEndRef = useRef<HTMLDivElement>(null)

	// Auto-scroll to latest thought
	useEffect(() => {
		if (thoughtsEndRef.current) {
			thoughtsEndRef.current.scrollIntoView({ behavior: "smooth" })
		}
	}, [thoughts])

	// Pulse animation when active
	useEffect(() => {
		if (isActive) {
			pulseAnimation.start({
				scale: [1, 1.1, 1],
				opacity: [1, 0.7, 1],
				transition: { duration: 2, repeat: Infinity },
			})
		} else {
			pulseAnimation.stop()
		}
	}, [isActive, pulseAnimation])

	const getPositionClasses = useCallback(() => {
		switch (position) {
			case "top-right":
				return "top-4 right-4"
			case "bottom-right":
				return "bottom-4 right-4"
			case "top-left":
				return "top-4 left-4"
			case "bottom-left":
				return "bottom-4 left-4"
			default:
				return "top-4 right-4"
		}
	}, [position])

	const getAgentIcon = useCallback((agent: AgentThought["agent"]) => {
		const iconProps = { className: "w-4 h-4" }

		switch (agent) {
			case "planner":
				return <Brain {...iconProps} />
			case "coder":
				return <Code {...iconProps} />
			case "verifier":
				return <CheckCircle {...iconProps} />
			case "orchestrator":
				return <Cpu {...iconProps} />
			case "researcher":
				return <Search {...iconProps} />
			default:
				return <Bot {...iconProps} />
		}
	}, [])

	const getAgentColor = useCallback((agent: AgentThought["agent"]) => {
		switch (agent) {
			case "planner":
				return "text-blue-500 bg-blue-500/10 border-blue-500/30"
			case "coder":
				return "text-green-500 bg-green-500/10 border-green-500/30"
			case "verifier":
				return "text-purple-500 bg-purple-500/10 border-purple-500/30"
			case "orchestrator":
				return "text-orange-500 bg-orange-500/10 border-orange-500/30"
			case "researcher":
				return "text-cyan-500 bg-cyan-500/10 border-cyan-500/30"
			default:
				return "text-gray-500 bg-gray-500/10 border-gray-500/30"
		}
	}, [])

	const getTypeIcon = useCallback((type: AgentThought["type"]) => {
		const iconProps = { className: "w-3 h-3" }

		switch (type) {
			case "thinking":
				return <Brain {...iconProps} />
			case "searching":
				return <Search {...iconProps} />
			case "coding":
				return <Code {...iconProps} />
			case "analyzing":
				return <Database {...iconProps} />
			case "verifying":
				return <CheckCircle {...iconProps} />
			case "completed":
				return <CheckCircle {...iconProps} />
			case "error":
				return <AlertCircle {...iconProps} />
			default:
				return <Activity {...iconProps} />
		}
	}, [])

	const getStatusColor = useCallback((type: AgentThought["type"]) => {
		switch (type) {
			case "thinking":
			case "searching":
			case "analyzing":
				return "text-blue-500"
			case "coding":
				return "text-green-500"
			case "verifying":
				return "text-purple-500"
			case "completed":
				return "text-emerald-500"
			case "error":
				return "text-red-500"
			default:
				return "text-gray-500"
		}
	}, [])

	const formatDuration = useCallback((ms: number) => {
		if (ms < 1000) return `${ms}ms`
		return `${(ms / 1000).toFixed(1)}s`
	}, [])

	const recentThoughts = thoughts.slice(-5)
	const allThoughts = expanded ? thoughts : recentThoughts

	if (isMinimized) {
		return (
			<motion.div
				className={cn(
					"fixed z-50 p-2 bg-vscode-toolbar-background border border-vscode-border rounded-full shadow-lg",
					getPositionClasses(),
					className,
				)}
				initial={{ scale: 0 }}
				animate={{ scale: 1 }}
				whileHover={{ scale: 1.1 }}
				onClick={() => setIsMinimized(false)}>
				<motion.div animate={pulseAnimation}>
					{isActive ? (
						<div className="w-3 h-3 bg-green-500 rounded-full" />
					) : (
						<div className="w-3 h-3 bg-gray-500 rounded-full" />
					)}
				</motion.div>
			</motion.div>
		)
	}

	return (
		<motion.div
			className={cn(
				"fixed z-50 w-80 bg-vscode-toolbar-background border border-vscode-border rounded-lg shadow-lg",
				getPositionClasses(),
				className,
			)}
			initial={{ opacity: 0, scale: 0.9, y: -20 }}
			animate={{ opacity: 1, scale: 1, y: 0 }}
			transition={{ duration: 0.3 }}>
			{/* Header */}
			<div className="flex items-center justify-between p-3 border-b border-vscode-border">
				<div className="flex items-center gap-2">
					<motion.div animate={pulseAnimation}>
						<Activity className="w-4 h-4 text-vscode-foreground" />
					</motion.div>
					<span className="text-sm font-medium text-vscode-foreground">Agent Activity</span>
					{currentAgent && (
						<Badge
							variant="secondary"
							className={cn("text-xs", getAgentColor(currentAgent as AgentThought["agent"]))}>
							{currentAgent}
						</Badge>
					)}
					{isActive && (
						<motion.div
							className="w-2 h-2 bg-green-500 rounded-full"
							animate={{ scale: [1, 1.2, 1] }}
							transition={{ duration: 1, repeat: Infinity }}
						/>
					)}
				</div>

				<div className="flex items-center gap-1">
					{showThoughts && (
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setExpanded(!expanded)}
							className="h-6 w-6 p-0">
							{expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
						</Button>
					)}
					<Button size="sm" variant="ghost" onClick={() => setIsMinimized(true)} className="h-6 w-6 p-0">
						<EyeOff className="w-3 h-3" />
					</Button>
				</div>
			</div>

			{/* Compact View */}
			{compact && (
				<div className="p-3">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Zap className="w-4 h-4 text-yellow-500" />
							<span className="text-sm text-vscode-foreground">
								{isActive ? "Processing..." : "Idle"}
							</span>
						</div>
						<Badge variant="outline" className="text-xs">
							{thoughts.length} thoughts
						</Badge>
					</div>
				</div>
			)}

			{/* Thoughts Stream */}
			{showThoughts && !compact && (
				<div className="max-h-96 overflow-y-auto">
					<AnimatePresence>
						{allThoughts.map((thought, index) => (
							<motion.div
								key={thought.id}
								initial={{ opacity: 0, x: -20 }}
								animate={{ opacity: 1, x: 0 }}
								exit={{ opacity: 0, x: 20 }}
								transition={{ duration: 0.2, delay: index * 0.05 }}
								className="p-3 border-b border-vscode-border/50 last:border-b-0">
								<div className="flex items-start gap-2">
									{/* Agent Icon */}
									<div className={cn("p-1 rounded border", getAgentColor(thought.agent))}>
										{getAgentIcon(thought.agent)}
									</div>

									{/* Content */}
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2 mb-1">
											<span className="text-xs font-medium text-vscode-foreground">
												{thought.agent}
											</span>
											<div
												className={cn("flex items-center gap-1", getStatusColor(thought.type))}>
												{getTypeIcon(thought.type)}
												<span className="text-xs capitalize">{thought.type}</span>
											</div>
											{thought.duration && (
												<span className="text-xs text-vscode-descriptionForeground">
													{formatDuration(thought.duration)}
												</span>
											)}
										</div>

										<p className="text-sm text-vscode-foreground break-words">{thought.message}</p>

										{thought.metadata && (
											<div className="mt-2 text-xs text-vscode-descriptionForeground">
												{Object.entries(thought.metadata).map(([key, value]) => (
													<div key={key} className="flex justify-between gap-2">
														<span>{key}:</span>
														<span>{String(value)}</span>
													</div>
												))}
											</div>
										)}
									</div>
								</div>
							</motion.div>
						))}
					</AnimatePresence>

					{thoughts.length === 0 && (
						<div className="p-6 text-center text-vscode-descriptionForeground">
							<Brain className="w-8 h-8 mx-auto mb-2 opacity-50" />
							<p className="text-sm">No agent activity yet</p>
						</div>
					)}

					<div ref={thoughtsEndRef} />
				</div>
			)}

			{/* Footer */}
			{showThoughts && !compact && thoughts.length > 0 && (
				<div className="p-2 border-t border-vscode-border">
					<div className="flex items-center justify-between text-xs text-vscode-descriptionForeground">
						<span>{thoughts.length} total thoughts</span>
						<span>Last: {new Date(thoughts[thoughts.length - 1]?.timestamp).toLocaleTimeString()}</span>
					</div>
				</div>
			)}
		</motion.div>
	)
}

// Agent Status Indicator Component
export interface AgentStatusIndicatorProps {
	agents: Array<{
		name: string
		status: "idle" | "active" | "completed" | "error"
		currentTask?: string
		progress?: number
	}>
	className?: string
}

export const AgentStatusIndicator: React.FC<AgentStatusIndicatorProps> = ({ agents, className }) => {
	const getStatusColor = useCallback((status: string) => {
		switch (status) {
			case "active":
				return "bg-green-500"
			case "completed":
				return "bg-blue-500"
			case "error":
				return "bg-red-500"
			default:
				return "bg-gray-500"
		}
	}, [])

	return (
		<div className={cn("flex items-center gap-2", className)}>
			{agents.map((agent) => (
				<div key={agent.name} className="relative group">
					<div
						className={cn(
							"w-3 h-3 rounded-full border-2 border-vscode-toolbar-background",
							getStatusColor(agent.status),
						)}
					/>

					{/* Tooltip */}
					<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
						<div className="bg-vscode-toolbar-background border border-vscode-border rounded-md shadow-lg p-2 text-xs whitespace-nowrap">
							<div className="font-medium text-vscode-foreground">{agent.name}</div>
							<div className="text-vscode-descriptionForeground capitalize">{agent.status}</div>
							{agent.currentTask && (
								<div className="text-vscode-foreground mt-1">{agent.currentTask}</div>
							)}
							{agent.progress !== undefined && (
								<div className="mt-1">
									<div className="w-20 h-1 bg-vscode-border rounded-full overflow-hidden">
										<div
											className="h-full bg-green-500 transition-all duration-300"
											style={{ width: `${agent.progress}%` }}
										/>
									</div>
								</div>
							)}
						</div>
					</div>
				</div>
			))}
		</div>
	)
}
