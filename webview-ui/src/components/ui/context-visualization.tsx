import React, { useState, useCallback, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "./button"
import { Badge } from "./badge"
import { Separator } from "./separator"
import { FileText, Database, MessageSquare, Hash, X, Plus, Eye, BookOpen, Code, Globe } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ContextItem {
	id: string
	type: "file" | "documentation" | "chat" | "jira" | "slack" | "workspace" | "symbol" | "definition"
	title: string
	subtitle?: string
	icon?: React.ReactNode
	metadata?: Record<string, any>
	active?: boolean
	removable?: boolean
	onClick?: () => void
	onRemove?: () => void
}

export interface ContextVisualizationProps {
	items: ContextItem[]
	maxVisible?: number
	showAddButton?: boolean
	onAddContext?: () => void
	onClearAll?: () => void
	className?: string
	variant?: "chips" | "breadcrumbs" | "compact"
}

export const ContextVisualization: React.FC<ContextVisualizationProps> = ({
	items,
	maxVisible = 5,
	showAddButton = true,
	onAddContext,
	onClearAll,
	className,
	variant = "chips",
}) => {
	const [expanded, setExpanded] = useState(false)
	const [hoveredItem, setHoveredItem] = useState<string | null>(null)

	const visibleItems = useMemo(() => {
		if (expanded) {
			return items
		}
		return items.slice(0, maxVisible)
	}, [items, expanded, maxVisible])

	const hasMore = items.length > maxVisible

	const getContextIcon = useCallback((type: ContextItem["type"]) => {
		const iconProps = { className: "w-4 h-4" }

		switch (type) {
			case "file":
				return <FileText {...iconProps} />
			case "documentation":
				return <BookOpen {...iconProps} />
			case "chat":
				return <MessageSquare {...iconProps} />
			case "jira":
				return <Hash {...iconProps} />
			case "slack":
				return <MessageSquare {...iconProps} />
			case "workspace":
				return <Globe {...iconProps} />
			case "symbol":
				return <Code {...iconProps} />
			case "definition":
				return <Database {...iconProps} />
			default:
				return <FileText {...iconProps} />
		}
	}, [])

	const getTypeColor = useCallback((type: ContextItem["type"]) => {
		switch (type) {
			case "file":
				return "bg-blue-500/10 text-blue-500 border-blue-500/30"
			case "documentation":
				return "bg-green-500/10 text-green-500 border-green-500/30"
			case "chat":
				return "bg-purple-500/10 text-purple-500 border-purple-500/30"
			case "jira":
				return "bg-orange-500/10 text-orange-500 border-orange-500/30"
			case "slack":
				return "bg-pink-500/10 text-pink-500 border-pink-500/30"
			case "workspace":
				return "bg-cyan-500/10 text-cyan-500 border-cyan-500/30"
			case "symbol":
				return "bg-yellow-500/10 text-yellow-500 border-yellow-500/30"
			case "definition":
				return "bg-indigo-500/10 text-indigo-500 border-indigo-500/30"
			default:
				return "bg-gray-500/10 text-gray-500 border-gray-500/30"
		}
	}, [])

	const renderChips = () => (
		<div className={cn("flex flex-wrap items-center gap-2", className)}>
			<AnimatePresence>
				{visibleItems.map((item, index) => (
					<motion.div
						key={item.id}
						initial={{ opacity: 0, scale: 0.8 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.8 }}
						transition={{ duration: 0.2, delay: index * 0.05 }}
						className={cn(
							"group relative flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm",
							"cursor-pointer transition-all duration-200 hover:shadow-md",
							getTypeColor(item.type),
							item.active && "ring-2 ring-vscode-focusBorder",
							hoveredItem === item.id && "scale-105",
						)}
						onClick={item.onClick}
						onMouseEnter={() => setHoveredItem(item.id)}
						onMouseLeave={() => setHoveredItem(null)}>
						{/* Icon */}
						<div className="flex-shrink-0">{item.icon || getContextIcon(item.type)}</div>

						{/* Content */}
						<div className="flex-1 min-w-0">
							<div className="font-medium truncate">{item.title}</div>
							{item.subtitle && <div className="text-xs opacity-70 truncate">{item.subtitle}</div>}
						</div>

						{/* Remove Button */}
						{item.removable && (
							<Button
								size="sm"
								variant="ghost"
								className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
								onClick={(e) => {
									e.stopPropagation()
									item.onRemove?.()
								}}>
								<X className="w-3 h-3" />
							</Button>
						)}

						{/* Hover Tooltip */}
						{hoveredItem === item.id && item.metadata && (
							<motion.div
								initial={{ opacity: 0, y: 4 }}
								animate={{ opacity: 1, y: 0 }}
								className="absolute bottom-full left-0 mb-2 z-50 p-2 bg-vscode-toolbar-background border border-vscode-border rounded-md shadow-lg text-xs">
								<div className="space-y-1">
									{Object.entries(item.metadata).map(([key, value]) => (
										<div key={key} className="flex justify-between gap-4">
											<span className="text-vscode-descriptionForeground">{key}:</span>
											<span className="text-vscode-foreground">{String(value)}</span>
										</div>
									))}
								</div>
							</motion.div>
						)}
					</motion.div>
				))}
			</AnimatePresence>

			{/* Expand/Collapse Button */}
			{hasMore && (
				<Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)} className="text-xs">
					{expanded ? "Show Less" : `+${items.length - maxVisible} More`}
				</Button>
			)}

			{/* Add Context Button */}
			{showAddButton && (
				<Button size="sm" variant="outline" onClick={onAddContext} className="gap-1">
					<Plus className="w-3 h-3" />
					Add Context
				</Button>
			)}

			{/* Clear All Button */}
			{items.length > 0 && onClearAll && (
				<Button
					size="sm"
					variant="ghost"
					onClick={onClearAll}
					className="text-xs text-vscode-descriptionForeground">
					Clear All
				</Button>
			)}
		</div>
	)

	const renderBreadcrumbs = () => (
		<div className={cn("flex items-center gap-2", className)}>
			<AnimatePresence>
				{visibleItems.map((item, index) => (
					<React.Fragment key={item.id}>
						<motion.div
							initial={{ opacity: 0, x: -10 }}
							animate={{ opacity: 1, x: 0 }}
							exit={{ opacity: 0, x: -10 }}
							transition={{ duration: 0.2, delay: index * 0.05 }}
							className={cn(
								"flex items-center gap-2 px-2 py-1 rounded text-sm",
								"cursor-pointer transition-all duration-200 hover:bg-vscode-toolbar-background",
								getTypeColor(item.type),
								item.active && "ring-1 ring-vscode-focusBorder",
							)}
							onClick={item.onClick}>
							{item.icon || getContextIcon(item.type)}
							<span className="truncate max-w-[120px]">{item.title}</span>
						</motion.div>

						{index < visibleItems.length - 1 && <Separator orientation="vertical" className="h-4" />}
					</React.Fragment>
				))}
			</AnimatePresence>

			{hasMore && (
				<Badge variant="secondary" className="text-xs">
					+{items.length - maxVisible}
				</Badge>
			)}
		</div>
	)

	const renderCompact = () => (
		<div className={cn("flex items-center gap-1", className)}>
			<AnimatePresence>
				{visibleItems.slice(0, 3).map((item, index) => (
					<motion.div
						key={item.id}
						initial={{ opacity: 0, scale: 0.8 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.8 }}
						transition={{ duration: 0.2, delay: index * 0.05 }}
						className={cn(
							"w-6 h-6 rounded-full flex items-center justify-center text-xs",
							"cursor-pointer transition-all duration-200 hover:scale-110",
							getTypeColor(item.type),
							item.active && "ring-2 ring-vscode-focusBorder",
						)}
						onClick={item.onClick}
						title={item.title}>
						{item.icon || getContextIcon(item.type)}
					</motion.div>
				))}
			</AnimatePresence>

			{items.length > 3 && (
				<Badge variant="secondary" className="text-xs">
					{items.length}
				</Badge>
			)}
		</div>
	)

	switch (variant) {
		case "breadcrumbs":
			return renderBreadcrumbs()
		case "compact":
			return renderCompact()
		default:
			return renderChips()
	}
}

// Context Statistics Component
export interface ContextStatsProps {
	items: ContextItem[]
	className?: string
}

export const ContextStats: React.FC<ContextStatsProps> = ({ items, className }) => {
	const stats = useMemo(() => {
		const grouped = items.reduce(
			(acc, item) => {
				acc[item.type] = (acc[item.type] || 0) + 1
				return acc
			},
			{} as Record<ContextItem["type"], number>,
		)

		return grouped
	}, [items])

	return (
		<div className={cn("flex items-center gap-4 text-xs text-vscode-descriptionForeground", className)}>
			<div className="flex items-center gap-2">
				<Eye className="w-3 h-3" />
				<span>{items.length} contexts</span>
			</div>

			{Object.entries(stats).map(([type, count]) => (
				<div key={type} className="flex items-center gap-1">
					{(() => {
						const iconProps = { className: "w-3 h-3" }
						switch (type as ContextItem["type"]) {
							case "file":
								return <FileText {...iconProps} />
							case "documentation":
								return <BookOpen {...iconProps} />
							case "chat":
								return <MessageSquare {...iconProps} />
							case "jira":
								return <Hash {...iconProps} />
							case "slack":
								return <MessageSquare {...iconProps} />
							case "workspace":
								return <Globe {...iconProps} />
							case "symbol":
								return <Code {...iconProps} />
							case "definition":
								return <Database {...iconProps} />
							default:
								return <FileText {...iconProps} />
						}
					})()}
					<span>{count}</span>
				</div>
			))}
		</div>
	)
}

// Helper function to create context items
export const createContextItem = (
	type: ContextItem["type"],
	title: string,
	options: Partial<ContextItem> = {},
): ContextItem => ({
	id: `${type}-${Date.now()}-${Math.random()}`,
	type,
	title,
	removable: true,
	...options,
})
