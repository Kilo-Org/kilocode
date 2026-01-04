// kilocode_change - new file

import React, { useState, useCallback } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

export interface RevertButtonProps {
	messageId: string
	onRevert?: (messageId: string) => void
	onPreview?: (messageId: string) => void
	disabled?: boolean
	_size?: "small" | "medium" | "large"
}

/**
 * Revert button component for chat messages
 */
export const RevertButton: React.FC<RevertButtonProps> = ({
	messageId,
	onRevert,
	onPreview,
	disabled = false,
	_size = "small",
}) => {
	const [isLoading, setIsLoading] = useState(false)
	const [showPreview, setShowPreview] = useState(false)

	const handleRevert = useCallback(async () => {
		if (disabled || isLoading) return

		setIsLoading(true)
		try {
			await onRevert?.(messageId)
		} finally {
			setIsLoading(false)
		}
	}, [messageId, onRevert, disabled, isLoading])

	const handlePreview = useCallback(async () => {
		if (disabled || isLoading) return

		setIsLoading(true)
		try {
			await onPreview?.(messageId)
			setShowPreview(true)
		} finally {
			setIsLoading(false)
		}
	}, [messageId, onPreview, disabled, isLoading])

	return (
		<div className="revert-button-container">
			<VSCodeButton
				appearance="icon"
				onClick={handlePreview}
				disabled={disabled || isLoading}
				title="Preview Revert"
				style={{ marginRight: "4px" }}>
				<span className="codicon codicon-eye"></span>
			</VSCodeButton>

			<VSCodeButton
				appearance="icon"
				onClick={handleRevert}
				disabled={disabled || isLoading}
				title="Revert Changes">
				<span className={`codicon ${isLoading ? "codicon-loading" : "codicon-undo"}`}></span>
			</VSCodeButton>

			{showPreview && (
				<RevertPreviewModal
					messageId={messageId}
					onClose={() => setShowPreview(false)}
					onConfirm={handleRevert}
				/>
			)}
		</div>
	)
}

export interface RevertPreview {
  messageId: string
  affectedFiles: Array<{
    filePath: string
    currentContent: string
    revertedContent: string
    hasConflicts: boolean
    conflictType?: string
  }>
  estimatedImpact: 'low' | 'medium' | 'high'
}

export interface RevertPreviewModalProps {
	messageId: string
	onClose: () => void
	onConfirm: () => void
}

/**
 * Modal for previewing revert changes
 */
export const RevertPreviewModal: React.FC<RevertPreviewModalProps> = ({ messageId, onClose, onConfirm }) => {
	const [preview, setPreview] = useState<RevertPreview | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	React.useEffect(() => {
		const loadPreview = async () => {
			setIsLoading(true)
			setError(null)

			try {
				// Send message to extension to get preview
				const response = await fetch("/api/revert-preview", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ messageId }),
				})

				if (!response.ok) {
					throw new Error("Failed to load preview")
				}

				const data = await response.json()
				setPreview(data)
			} catch (err) {
				setError(err instanceof Error ? err.message : "Unknown error")
			} finally {
				setIsLoading(false)
			}
		}

		loadPreview()
	}, [messageId])

	const handleConfirm = async () => {
		await onConfirm()
		onClose()
	}

	if (isLoading) {
		return (
			<div className="modal-overlay">
				<div className="modal-content">
					<div className="modal-header">
						<h3>Preview Revert</h3>
						<VSCodeButton appearance="icon" onClick={onClose}>
							<span className="codicon codicon-close"></span>
						</VSCodeButton>
					</div>
					<div className="modal-body">
						<div className="loading-spinner">
							<span className="codicon codicon-loading spin"></span>
							Loading preview...
						</div>
					</div>
				</div>
			</div>
		)
	}

	if (error) {
		return (
			<div className="modal-overlay">
				<div className="modal-content">
					<div className="modal-header">
						<h3>Preview Revert</h3>
						<VSCodeButton appearance="icon" onClick={onClose}>
							<span className="codicon codicon-close"></span>
						</VSCodeButton>
					</div>
					<div className="modal-body">
						<div className="error-message">
							<span className="codicon codicon-error"></span>
							{error}
						</div>
					</div>
					<div className="modal-footer">
						<VSCodeButton onClick={onClose}>Close</VSCodeButton>
					</div>
				</div>
			</div>
		)
	}

	if (!preview) return null

	return (
		<div className="modal-overlay">
			<div className="modal-content large">
				<div className="modal-header">
					<h3>Preview Revert</h3>
					<VSCodeButton appearance="icon" onClick={onClose}>
						<span className="codicon codicon-close"></span>
					</VSCodeButton>
				</div>

				<div className="modal-body">
					<div className="preview-summary">
						<div className="impact-indicator">
							<span className={`impact-badge ${preview.estimatedImpact}`}>
								{preview.estimatedImpact.toUpperCase()} IMPACT
							</span>
						</div>
						<div className="files-count">{preview.affectedFiles.length} file(s) will be reverted</div>
					</div>

					<div className="files-list">
						{preview.affectedFiles.map((file: any, index: number) => (
							<div key={index} className="file-preview-item">
								<div className="file-header">
									<span className="codicon codicon-file"></span>
									<span className="file-path">{file.filePath}</span>
									{file.hasConflicts && (
										<span className="conflict-badge">
											<span className="codicon codicon-warning"></span>
											{file.conflictType}
										</span>
									)}
								</div>

								<div className="file-diff">
									<div className="diff-view">
										<SideBySideDiff
											original={file.currentContent}
											modified={file.revertedContent}
											filePath={file.filePath}
										/>
									</div>
								</div>
							</div>
						))}
					</div>
				</div>

				<div className="modal-footer">
					<VSCodeButton onClick={onClose}>Cancel</VSCodeButton>
					<VSCodeButton
						appearance="primary"
						onClick={handleConfirm}
						disabled={preview.affectedFiles.some((f: any) => f.hasConflicts)}>
						Confirm Revert
					</VSCodeButton>
					{preview.affectedFiles.some((f: any) => f.hasConflicts) && (
						<div className="conflict-warning">
							Cannot revert due to conflicts. Please resolve conflicts first.
						</div>
					)}
				</div>
			</div>
		</div>
	)
}

export interface SideBySideDiffProps {
	original: string
	modified: string
	filePath: string
}

/**
 * Side-by-side diff view component
 */
export const SideBySideDiff: React.FC<SideBySideDiffProps> = ({ original, modified, filePath }) => {
	const originalLines = original.split("\n")
	const modifiedLines = modified.split("\n")
	// Note: maxLines calculated but not currently used in rendering

	return (
		<div className="side-by-side-diff">
			<div className="diff-header">
				<div className="file-info">
					<span className="codicon codicon-file-text"></span>
					{filePath}
				</div>
				<div className="diff-stats">
					<span className="original-label">Current</span>
					<span className="modified-label">Reverted</span>
				</div>
			</div>

			<div className="diff-content">
				<div className="diff-scroll-container">
					<div className="diff-columns">
						<div className="diff-column original">
							{originalLines.map((line, index) => (
								<div key={index} className="diff-line">
									<span className="line-number">{index + 1}</span>
									<span className="line-content">{line || "\u00A0"}</span>
								</div>
							))}
						</div>

						<div className="diff-column modified">
							{modifiedLines.map((line, index) => (
								<div key={index} className="diff-line">
									<span className="line-number">{index + 1}</span>
									<span className="line-content">{line || "\u00A0"}</span>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}

export interface ConflictResolutionProps {
	conflicts: any[]
	onResolve: (resolutions: Map<string, string>) => void
	onCancel: () => void
}

/**
 * Conflict resolution modal
 */
export const ConflictResolutionModal: React.FC<ConflictResolutionProps> = ({ conflicts, onResolve, onCancel }) => {
	const [resolutions, setResolutions] = useState<Map<string, string>>(new Map())

	const handleResolutionChange = (filePath: string, resolution: string) => {
		const newResolutions = new Map(resolutions)
		newResolutions.set(filePath, resolution)
		setResolutions(newResolutions)
	}

	const handleConfirm = () => {
		onResolve(resolutions)
	}

	return (
		<div className="modal-overlay">
			<div className="modal-content large">
				<div className="modal-header">
					<h3>Resolve Conflicts</h3>
					<VSCodeButton appearance="icon" onClick={onCancel}>
						<span className="codicon codicon-close"></span>
					</VSCodeButton>
				</div>

				<div className="modal-body">
					<div className="conflicts-intro">
						<p>
							Manual changes detected in the following files. Please choose how to resolve each conflict:
						</p>
					</div>

					<div className="conflicts-list">
						{conflicts.map((conflict, index) => (
							<div key={index} className="conflict-item">
								<div className="conflict-header">
									<span className="codicon codicon-warning"></span>
									<span className="file-path">{conflict.filePath}</span>
									<span className="conflict-type">{conflict.conflictType}</span>
								</div>

								<div className="conflict-details">
									<div className="conflict-description">
										{conflict.conflictType === "manual_edits" &&
											"File has been manually modified since the AI edit"}
										{conflict.conflictType === "file_missing" && "File no longer exists"}
										{conflict.conflictType === "permission_denied" && "Permission denied"}
										{conflict.conflictType === "checksum_mismatch" &&
											"File content has changed unexpectedly"}
									</div>

									<div className="resolution-options">
										<label>
											<input
												type="radio"
												name={`resolution-${index}`}
												value="force"
												onChange={(e) =>
													handleResolutionChange(conflict.filePath, e.target.value)
												}
											/>
											Force Revert (overwrite changes)
										</label>

										<label>
											<input
												type="radio"
												name={`resolution-${index}`}
												value="merge"
												onChange={(e) =>
													handleResolutionChange(conflict.filePath, e.target.value)
												}
											/>
											Merge (attempt intelligent merge)
										</label>

										<label>
											<input
												type="radio"
												name={`resolution-${index}`}
												value="skip"
												onChange={(e) =>
													handleResolutionChange(conflict.filePath, e.target.value)
												}
											/>
											Skip (keep current file)
										</label>
									</div>
								</div>
							</div>
						))}
					</div>
				</div>

				<div className="modal-footer">
					<VSCodeButton onClick={onCancel}>Cancel</VSCodeButton>
					<VSCodeButton
						appearance="primary"
						onClick={handleConfirm}
						disabled={resolutions.size !== conflicts.length}>
						Apply Resolutions
					</VSCodeButton>
				</div>
			</div>
		</div>
	)
}

// CSS styles (these would typically be in a separate CSS file)
export const revertStyles = `
.revert-button-container {
  display: flex;
  align-items: center;
  gap: 4px;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background-color: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  max-width: 90vw;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-content.large {
  max-width: 95vw;
  max-height: 95vh;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.modal-body {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid var(--vscode-panel-border);
}

.loading-spinner {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 8px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.error-message {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--vscode-errorForeground);
  padding: 16px;
  background-color: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  border-radius: 4px;
}

.preview-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding: 12px;
  background-color: var(--vscode-textBlockQuote-background);
  border-left: 4px solid var(--vscode-textBlockQuote-border);
  border-radius: 4px;
}

.impact-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.impact-badge.low {
  background-color: var(--vscode-testing-iconPassed);
  color: white;
}

.impact-badge.medium {
  background-color: var(--vscode-testing-iconSkipped);
  color: white;
}

.impact-badge.high {
  background-color: var(--vscode-testing-iconFailed);
  color: white;
}

.files-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.file-preview-item {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  overflow: hidden;
}

.file-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background-color: var(--vscode-editor-background);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.file-path {
  font-family: monospace;
  font-size: 14px;
  flex: 1;
}

.conflict-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background-color: var(--vscode-warningBackground);
  color: var(--vscode-warningForeground);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.file-diff {
  max-height: 300px;
  overflow: hidden;
}

.diff-view {
  height: 100%;
}

.side-by-side-diff {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.diff-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: var(--vscode-panel-background);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.diff-stats {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.diff-content {
  flex: 1;
  overflow: hidden;
}

.diff-scroll-container {
  height: 100%;
  overflow: auto;
}

.diff-columns {
  display: flex;
  height: 100%;
}

.diff-column {
  flex: 1;
  border-right: 1px solid var(--vscode-panel-border);
}

.diff-column:last-child {
  border-right: none;
}

.diff-line {
  display: flex;
  min-height: 20px;
}

.diff-line:hover {
  background-color: var(--vscode-list-hoverBackground);
}

.line-number {
  width: 60px;
  padding: 0 8px;
  text-align: right;
  color: var(--vscode-descriptionForeground);
  border-right: 1px solid var(--vscode-panel-border);
  font-family: monospace;
  font-size: 12px;
  line-height: 20px;
  user-select: none;
}

.line-content {
  flex: 1;
  padding: 0 8px;
  font-family: monospace;
  font-size: 14px;
  line-height: 20px;
  white-space: pre;
}

.conflict-warning {
  color: var(--vscode-warningForeground);
  font-size: 12px;
  margin-top: 8px;
}

.conflicts-intro {
  margin-bottom: 20px;
  padding: 12px;
  background-color: var(--vscode-textBlockQuote-background);
  border-left: 4px solid var(--vscode-textBlockQuote-border);
  border-radius: 4px;
}

.conflicts-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.conflict-item {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  overflow: hidden;
}

.conflict-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background-color: var(--vscode-editor-background);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.conflict-type {
  margin-left: auto;
  padding: 4px 8px;
  background-color: var(--vscode-warningBackground);
  color: var(--vscode-warningForeground);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.conflict-details {
  padding: 16px;
}

.conflict-description {
  margin-bottom: 16px;
  color: var(--vscode-descriptionForeground);
}

.resolution-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.resolution-options label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.resolution-options input[type="radio"] {
  margin: 0;
}
`
