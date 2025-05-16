import React, { memo } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { ClineMessage } from "@roo/shared/ExtensionMessage"
import { vscode } from "@src/utils/vscode"

type AutoApprovedRequestLimitWarningProps = {
	message: ClineMessage
}

export const AutoApprovedRequestLimitWarning = memo(({ message }: AutoApprovedRequestLimitWarningProps) => {
	const { title, description, button } = JSON.parse(message.text ?? "{}")
	return (
		<>
			<div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--vscode-foreground)" }}>
				<span className="codicon codicon-warning" />
				<span style={{ fontWeight: "bold" }}>{title}</span>
			</div>

			<div
				className="bg-vscode-panel-border flex flex-col gap-3"
				style={{
					borderRadius: "4px",
					display: "flex",
					marginTop: "15px",
					padding: "14px 16px 22px",
					justifyContent: "center",
				}}>
				<div className="flex justify-between items-center">{description}</div>
				<VSCodeButton
					style={{ width: "100%", padding: "6px", borderRadius: "4px" }}
					onClick={(e) => {
						e.preventDefault()
						vscode.postMessage({ type: "askResponse", askResponse: "retry_clicked" })
					}}>
					{button}
				</VSCodeButton>
			</div>
		</>
	)
})
