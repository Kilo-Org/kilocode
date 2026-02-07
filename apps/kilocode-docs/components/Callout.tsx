import * as React from "react"

type CalloutType = "generic" | "note" | "tip" | "info" | "warning" | "danger"

interface CalloutProps {
	type?: CalloutType
	title?: string
	collapsed?: boolean
	children: React.ReactNode
}

const typeConfig: Record<
	CalloutType,
	{
		icon: string | null
		defaultTitle: string | null
		borderColor: string
		bgColor: string
		titleColor: string
		iconColor: string
	}
> = {
	generic: {
		icon: null,
		defaultTitle: null,
		borderColor: "border-l-gray-300 dark:border-l-gray-600",
		bgColor: "bg-gray-50 dark:bg-gray-800/50",
		titleColor: "text-gray-700 dark:text-gray-300",
		iconColor: "text-gray-400",
	},
	note: {
		icon: "📝",
		defaultTitle: "Note",
		borderColor: "border-l-gray-500",
		bgColor: "bg-gray-50 dark:bg-gray-800/50",
		titleColor: "text-gray-700 dark:text-gray-300",
		iconColor: "text-gray-500",
	},
	tip: {
		icon: "💡",
		defaultTitle: "Tip",
		borderColor: "border-l-green-500",
		bgColor: "bg-green-50 dark:bg-green-900/20",
		titleColor: "text-green-700 dark:text-green-400",
		iconColor: "text-green-500",
	},
	info: {
		icon: "ℹ️",
		defaultTitle: "Info",
		borderColor: "border-l-blue-500",
		bgColor: "bg-blue-50 dark:bg-blue-900/20",
		titleColor: "text-blue-700 dark:text-blue-400",
		iconColor: "text-blue-500",
	},
	warning: {
		icon: "⚠️",
		defaultTitle: "Warning",
		borderColor: "border-l-yellow-500",
		bgColor: "bg-yellow-50 dark:bg-yellow-900/20",
		titleColor: "text-yellow-700 dark:text-yellow-400",
		iconColor: "text-yellow-500",
	},
	danger: {
		icon: "🚨",
		defaultTitle: "Danger",
		borderColor: "border-l-red-500",
		bgColor: "bg-red-50 dark:bg-red-900/20",
		titleColor: "text-red-700 dark:text-red-400",
		iconColor: "text-red-500",
	},
}

export function Callout({ type = "note", title, collapsed = false, children }: CalloutProps) {
	const [isExpanded, setIsExpanded] = React.useState(!collapsed)
	const config = typeConfig[type]
	const displayTitle = title ?? config.defaultTitle
	const showHeader = displayTitle || config.icon

	// If collapsed prop is set, make the header clickable
	if (collapsed) {
		return (
			<div className={`my-4 border-l-4 ${config.borderColor} ${config.bgColor} rounded-r-lg p-4`}>
				{showHeader && (
					<button
						type="button"
						onClick={() => setIsExpanded(!isExpanded)}
						className={`flex items-center gap-2 font-semibold ${config.titleColor} w-full text-left cursor-pointer ${isExpanded ? "mb-2" : ""}`}
						aria-expanded={isExpanded}>
						<span
							className={`transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
							aria-hidden="true">
							▶
						</span>
						{config.icon && <span className={config.iconColor}>{config.icon}</span>}
						{displayTitle && <span className="uppercase text-sm tracking-wide">{displayTitle}</span>}
					</button>
				)}
				{isExpanded && <div className="text-gray-700 dark:text-gray-300 [&>p]:m-0">{children}</div>}
			</div>
		)
	}

	// Default non-collapsible behavior
	return (
		<div className={`my-4 border-l-4 ${config.borderColor} ${config.bgColor} rounded-r-lg p-4`}>
			{showHeader && (
				<div className={`flex items-center gap-2 font-semibold ${config.titleColor} mb-2`}>
					{config.icon && <span className={config.iconColor}>{config.icon}</span>}
					{displayTitle && <span className="uppercase text-sm tracking-wide">{displayTitle}</span>}
				</div>
			)}
			<div className="text-gray-700 dark:text-gray-300 [&>p]:m-0">{children}</div>
		</div>
	)
}
