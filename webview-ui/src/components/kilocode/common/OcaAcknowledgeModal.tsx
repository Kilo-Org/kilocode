import React from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

type OcaAcknowledgeModalProps = {
	open: boolean
	bannerHtml?: string | null
	onAcknowledge: () => void
	onCancel: () => void
}

export const OcaAcknowledgeModal: React.FC<OcaAcknowledgeModalProps> = ({
	open,
	bannerHtml,
	onAcknowledge,
	onCancel,
}) => {
	if (!open) return null

	return (
		<div className="fixed inset-0 z-[2000] bg-black/25 flex items-center justify-center">
			<div
				aria-labelledby="oca-popup-title"
				aria-modal="true"
				role="dialog"
				className="p-6 max-w-[600px] w-[90%] rounded-[8px] shadow-xl border border-[var(--vscode-focusBorder,#007acc)]"
				style={{
					background: "var(--vscode-editor-background,#252526)",
					color: "var(--vscode-foreground,#cccccc)",
					fontFamily: "var(--vscode-font-family,sans-serif)",
					fontSize: "var(--vscode-font-size,13px)",
					maxHeight: "80vh",
					overflow: "hidden",
				}}>
				<h2
					id="oca-popup-title"
					className="mt-0 font-bold"
					style={{ color: "var(--vscode-foreground,#dddddd)" }}>
					Acknowledgement Required
				</h2>
				<h4 className="mb-2 font-semibold" style={{ color: "var(--vscode-descriptionForeground,#b3b3b3)" }}>
					Disclaimer: Prohibited Data Submission
				</h4>
				<div
					className="overflow-y-auto flex-1 pr-2 mb-4 text-[13px] leading-[1.5]"
					style={{
						color: "var(--vscode-foreground,#dddddd)",
						maskImage: "linear-gradient(to bottom, black 96%, transparent 100%)",
						WebkitMaskImage: "linear-gradient(to bottom, black 96%, transparent 100%)",
						maxHeight: "50vh",
					}}>
					{bannerHtml ? (
						<div dangerouslySetInnerHTML={{ __html: bannerHtml }} />
					) : (
						<div>This model requires acknowledgement before use.</div>
					)}
				</div>
				<div className="flex gap-2 justify-end">
					<VSCodeButton appearance="secondary" onClick={onCancel}>
						Cancel
					</VSCodeButton>
					<VSCodeButton onClick={onAcknowledge}>I acknowledge and agree</VSCodeButton>
				</div>
			</div>
		</div>
	)
}

export default OcaAcknowledgeModal
