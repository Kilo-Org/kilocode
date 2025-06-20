import React, { useState } from "react"
import { VSCodeButton, VSCodeTextField, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"

interface QueueManagerProps {
	className?: string
}

export const QueueManager: React.FC<QueueManagerProps> = ({ className }) => {
	const { t } = useAppTranslation()
	const { queuedPrompt, autoQueueEnabled, isProcessingQueue, setQueuedPrompt, setAutoQueueEnabled } =
		useExtensionState()

	const [tempPrompt, setTempPrompt] = useState(queuedPrompt || "")
	const [isExpanded, setIsExpanded] = useState(false)

	const handleSetQueue = () => {
		if (tempPrompt.trim()) {
			setQueuedPrompt(tempPrompt.trim())
			setIsExpanded(false)
		}
	}

	const handleClearQueue = () => {
		setQueuedPrompt(null)
		setTempPrompt("")
		setIsExpanded(false)
	}

	const hasQueuedPrompt = !!queuedPrompt

	return (
		<div className={`queue-manager ${className || ""}`}>
			{/* Queue Status Indicator */}
			<div className="flex items-center gap-2 p-2 bg-vscode-editor-background border border-vscode-editorGroup-border rounded">
				<VSCodeCheckbox
					checked={autoQueueEnabled}
					onChange={(e: any) => setAutoQueueEnabled(e.target.checked)}
					disabled={isProcessingQueue}>
					Auto-Queue
				</VSCodeCheckbox>

				{hasQueuedPrompt && (
					<div className="flex items-center gap-2 flex-1">
						<span className="codicon codicon-clock text-vscode-descriptionForeground" />
						<span className="text-sm text-vscode-descriptionForeground truncate">
							Queued: {queuedPrompt.substring(0, 50)}...
						</span>
						<VSCodeButton appearance="icon" onClick={handleClearQueue} disabled={isProcessingQueue}>
							<span className="codicon codicon-close" />
						</VSCodeButton>
					</div>
				)}

				{!hasQueuedPrompt && (
					<VSCodeButton
						appearance="secondary"
						onClick={() => setIsExpanded(!isExpanded)}
						disabled={isProcessingQueue}>
						<span className="codicon codicon-add" />
						Set Queue
					</VSCodeButton>
				)}

				{isProcessingQueue && (
					<div className="flex items-center gap-1">
						<span className="codicon codicon-loading codicon-modifier-spin" />
						<span className="text-sm text-vscode-descriptionForeground">Processing...</span>
					</div>
				)}
			</div>

			{/* Queue Input (Expanded) */}
			{isExpanded && (
				<div className="mt-2 p-3 bg-vscode-editor-background border border-vscode-editorGroup-border rounded">
					<div className="mb-2">
						<label className="block text-sm font-medium mb-1">Queue Prompt:</label>
						<VSCodeTextField
							value={tempPrompt}
							onInput={(e: any) => setTempPrompt(e.target.value)}
							placeholder="Enter the prompt to execute when tasks complete..."
							className="w-full"
						/>
					</div>
					<div className="flex gap-2">
						<VSCodeButton onClick={handleSetQueue} disabled={!tempPrompt.trim()}>
							Set Queue
						</VSCodeButton>
						<VSCodeButton appearance="secondary" onClick={() => setIsExpanded(false)}>
							Cancel
						</VSCodeButton>
					</div>
				</div>
			)}
		</div>
	)
}
