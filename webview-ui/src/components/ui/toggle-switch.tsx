import React from "react"

export interface ToggleSwitchProps {
	checked: boolean
	onChange: () => void
	disabled?: boolean
	size?: "small" | "medium"
	"aria-label"?: string
	"data-testid"?: string
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
	checked,
	onChange,
	disabled = false,
	size = "small",
	"aria-label": ariaLabel,
	"data-testid": dataTestId,
}) => {
	const dimensions = size === "small" ? { width: 20, height: 10, dotSize: 8 } : { width: 26, height: 10, dotSize: 6 }

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault()
			if (!disabled) {
				onChange()
			}
		}
	}

	return (
		<div
			role="switch"
			aria-checked={checked}
			aria-label={ariaLabel}
			tabIndex={disabled ? -1 : 0}
			data-testid={dataTestId}
			style={{
				width: `${dimensions.width}px`,
				height: `${dimensions.height}px`,
				backgroundColor: checked
					? "var(--vscode-button-background)"
					: "var(--vscode-button-secondaryBackground)",
				borderRadius: `${dimensions.height / 2}px`,
				position: "relative",
				cursor: disabled ? "not-allowed" : "pointer",
				transition: "background-color 0.2s",
				opacity: disabled ? 0.6 : 1,
			}}
			onClick={disabled ? undefined : onChange}
			onKeyDown={handleKeyDown}>
			<div
				style={{
					width: `${dimensions.dotSize}px`,
					height: `${dimensions.dotSize}px`,
					backgroundColor: "var(--vscode-foreground)",
					borderRadius: "50%",
					position: "absolute",
					top: `${(dimensions.height - dimensions.dotSize) / 2}px`,
					left: checked
						? `${dimensions.width - dimensions.dotSize - (dimensions.height - dimensions.dotSize) / 2}px`
						: `${(dimensions.height - dimensions.dotSize) / 2}px`,
					transition: "left 0.2s",
				}}
			/>
		</div>
	)
}
