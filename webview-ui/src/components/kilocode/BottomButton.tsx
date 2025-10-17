import React from "react"

interface BottomButtonProps {
	onClick: () => void
	iconClass: string
	ariaLabel?: string
	title?: string
}

const BottomButton = React.forwardRef<HTMLButtonElement, BottomButtonProps>(
	({ onClick, iconClass, ariaLabel, title, ...props }, ref) => {
		return (
			<button
				ref={ref}
				className="vscode-button flex items-center gap-1.5 p-0.75 rounded-sm text-vscode-foreground cursor-pointer hover:bg-vscode-list-hoverBackground"
				aria-label={ariaLabel}
				title={title}
				onClick={onClick}
				{...props}>
				<span className={`codicon ${iconClass} text-sm`}></span>
			</button>
		)
	},
)

export default BottomButton
