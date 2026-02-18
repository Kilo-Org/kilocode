import React from "react"
import "@vscode/codicons/dist/codicon.css"

interface CodiconProps {
	name: string
	size?: string
	className?: string
}

export function Codicon({ name, size = "1em", className = "" }: CodiconProps) {
	return (
		<i
			className={`codicon codicon-${name} ${className}`.trim()}
			style={{
				fontSize: size,
				verticalAlign: "middle",
				display: "inline",
			}}
			aria-hidden="true"
		/>
	)
}
