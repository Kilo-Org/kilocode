import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { ThinkingSpinner } from "./ThinkingSpinner"

interface ProgressIndicatorProps {
	useSpinner?: boolean
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ useSpinner = false }) => {
	if (useSpinner) {
		return (
			<div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
				<ThinkingSpinner className="text-vscode-foreground" />
			</div>
		)
	}

	return (
		<div
			style={{
				width: "16px",
				height: "16px",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
			}}>
			<div style={{ transform: "scale(0.55)", transformOrigin: "center" }}>
				<VSCodeProgressRing />
			</div>
		</div>
	)
}
