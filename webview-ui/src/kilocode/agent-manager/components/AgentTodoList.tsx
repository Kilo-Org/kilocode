import { cn } from "../../../lib/utils"
import { useTranslation } from "react-i18next"
import { Check, ChevronDown, ChevronUp, Circle, Loader2 } from "lucide-react"
import { useState, useRef, useEffect } from "react"
import type { TodoStats } from "../state/atoms/todos"

interface AgentTodoListProps {
	stats: TodoStats
	isIntegrated?: boolean
}

function TodoIcon({ status, size = "sm" }: { status: string; size?: "sm" | "xs" }) {
	const iconSize = size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5"
	const checkSize = size === "xs" ? "w-2 h-2" : "w-2.5 h-2.5"

	switch (status) {
		case "completed":
			return (
				<div className={cn("flex items-center justify-center rounded-full bg-green-500/20", iconSize)}>
					<Check className={cn("text-green-400", checkSize)} strokeWidth={3} />
				</div>
			)
		case "in_progress":
			return <Loader2 className={cn("text-vscode-charts-yellow animate-spin", iconSize)} />
		default:
			return <Circle className={cn("text-vscode-descriptionForeground/40", iconSize)} strokeWidth={2} />
	}
}

export function AgentTodoList({ stats, isIntegrated = false }: AgentTodoListProps) {
	const { t } = useTranslation("chat")
	const [isExpanded, setIsExpanded] = useState(false)
	const listRef = useRef<HTMLDivElement>(null)

	const { todos, completedCount, totalCount, currentTodo, allCompleted, progressPercent } = stats

	// Auto-scroll to in-progress item when expanded
	useEffect(() => {
		if (!isExpanded || !listRef.current) return
		const inProgressIdx = todos.findIndex((t) => t.status === "in_progress")
		if (inProgressIdx === -1) return
		const items = listRef.current.querySelectorAll("[data-todo-item]")
		const target = items[inProgressIdx] as HTMLElement
		if (target) {
			target.scrollIntoView({ behavior: "smooth", block: "center" })
		}
	}, [isExpanded, todos])

	if (totalCount <= 0) return null

	return (
		<div
			className={cn(
				"overflow-hidden transition-all duration-200",
				// When integrated, parent handles outer border; just add bottom separator
				isIntegrated
					? "border-b border-vscode-input-border/50"
					: "rounded-t-md border-x border-t border-vscode-input-border",
				"bg-vscode-input-background",
			)}>
			{/* Header - compact single line */}
			<button
				type="button"
				onClick={() => setIsExpanded(!isExpanded)}
				className={cn(
					"w-full flex items-center gap-2 px-3 py-1.5",
					"hover:bg-vscode-list-hoverBackground/30 transition-colors",
					"focus:outline-none",
					"cursor-pointer",
				)}>
				{/* Progress ring - smaller */}
				<div className="relative flex-shrink-0">
					<svg className="w-4 h-4 -rotate-90" viewBox="0 0 16 16">
						<circle
							cx="8"
							cy="8"
							r="6"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							className="text-vscode-input-border/40"
						/>
						<circle
							cx="8"
							cy="8"
							r="6"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeDasharray={`${progressPercent * 0.377} 100`}
							strokeLinecap="round"
							className={cn(
								"transition-all duration-300",
								allCompleted ? "text-green-400" : "text-vscode-charts-yellow",
							)}
						/>
					</svg>
					{allCompleted && (
						<Check className="absolute inset-0 m-auto w-2 h-2 text-green-400" strokeWidth={3} />
					)}
				</div>

				{/* Current task text */}
				<span
					className={cn(
						"flex-1 text-xs truncate text-left",
						allCompleted ? "text-green-400" : "text-vscode-foreground",
					)}>
					{allCompleted
						? t("todo.complete", { total: completedCount })
						: currentTodo?.content || t("todo.partial", { completed: completedCount, total: totalCount })}
				</span>

				{/* Counter */}
				<span className="flex-shrink-0 text-[10px] text-vscode-descriptionForeground/70 tabular-nums">
					{completedCount}/{totalCount}
				</span>

				{/* Chevron */}
				{isExpanded ? (
					<ChevronDown className="w-3 h-3 text-vscode-descriptionForeground/50" />
				) : (
					<ChevronUp className="w-3 h-3 text-vscode-descriptionForeground/50" />
				)}
			</button>

			{/* Expanded list - compact */}
			{isExpanded && (
				<div ref={listRef} className="max-h-[140px] overflow-y-auto border-t border-vscode-input-border/50">
					<div className="py-1 px-1">
						{todos.map((todo, idx) => (
							<div
								key={todo.id || idx}
								data-todo-item
								className={cn(
									"flex items-center gap-2 py-0.5 px-2 rounded transition-colors",
									todo.status === "in_progress" && "bg-vscode-charts-yellow/10",
								)}>
								<TodoIcon status={todo.status} size="xs" />
								<span
									className={cn(
										"text-xs truncate",
										todo.status === "in_progress" && "text-vscode-charts-yellow",
										todo.status === "completed" &&
											"line-through text-vscode-descriptionForeground/50",
										todo.status === "pending" && "text-vscode-descriptionForeground",
									)}>
									{todo.content}
								</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	)
}
