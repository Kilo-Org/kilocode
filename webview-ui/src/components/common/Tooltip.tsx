// kilocode addition, similar to cline's Tooltip

import React, { useState } from "react"

interface TooltipProps {
	tipText: string
	visible?: boolean
	children: React.ReactNode
}

const Tooltip: React.FC<TooltipProps> = ({ tipText, visible, children }) => {
	const [isVisible, setIsVisible] = useState(false)

	const shouldShow = visible !== undefined ? visible : isVisible

	return (
		<div
			className="relative inline-block"
			onMouseEnter={() => visible === undefined && setIsVisible(true)}
			onMouseLeave={() => visible === undefined && setIsVisible(false)}>
			{children}
			{shouldShow && (
				<div
					className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-black rounded whitespace-nowrap z-50"
					style={{
						backgroundColor: "var(--vscode-editorHoverWidget-background)",
						color: "var(--vscode-editorHoverWidget-foreground)",
						border: "1px solid var(--vscode-editorHoverWidget-border)",
					}}>
					{tipText}
					<div
						className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0"
						style={{
							borderLeft: "4px solid transparent",
							borderRight: "4px solid transparent",
							borderTop: "4px solid var(--vscode-editorHoverWidget-border)",
						}}
					/>
				</div>
			)}
		</div>
	)
}

export default Tooltip
