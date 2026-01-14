/**
 * Next Edit Panel Component
 *
 * Displays the current edit in a Next Edit session with diff view,
 * context information, and action buttons (Accept, Skip, Undo).
 *
 * @module NextEditPanel
 */

import React, { useEffect, useState, useRef, useCallback } from "react"
import { vscode } from "../../utils/vscode"
import { Button } from "../ui/button"
import { Check, X, Undo, FileCode } from "lucide-react"

interface NextEdit {
	id: string
	filePath: string
	originalContent: string
	newContent: string
	rationale: string
	context?: {
		before: string
		after: string
	}
}

interface NextEditProgress {
	current: number
	total: number
	completed: number
	skipped: number
	remaining: number
	percentage: number
}

interface NextEditPanelProps {
	isVisible: boolean
	onClose: () => void
}

/**
 * Next Edit Panel Component
 */
export const NextEditPanel: React.FC<NextEditPanelProps> = ({ isVisible, onClose }) => {
	const [currentEdit, setCurrentEdit] = useState<NextEdit | null>(null)
	const [progress, setProgress] = useState<NextEditProgress | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const panelRef = useRef<HTMLDivElement>(null)
	const acceptButtonRef = useRef<HTMLButtonElement>(null)

	// Handle messages from extension
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data

			switch (message.type) {
				case "nextEdit.started":
					setIsLoading(true)
					break

				case "nextEdit.edit":
					setCurrentEdit(message.edit)
					setIsLoading(false)
					break

				case "nextEdit.progress":
					setProgress(message.progress)
					break

				case "nextEdit.completed":
					setIsLoading(false)
					setCurrentEdit(null)
					// TODO: Show completion summary
					break

				case "nextEdit.error":
					setIsLoading(false)
					console.error("Next Edit error:", message.error)
					break
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	// Handle keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (!isVisible || !currentEdit) return

			// Ctrl+Enter: Accept edit
			if (e.ctrlKey && e.key === "Enter") {
				e.preventDefault()
				handleAccept()
			}
			// Ctrl+Shift+Enter: Skip edit
			if (e.ctrlKey && e.shiftKey && e.key === "Enter") {
				e.preventDefault()
				handleSkip()
			}
			// Ctrl+Z: Undo edit
			if (e.ctrlKey && e.key === "z") {
				e.preventDefault()
				handleUndo()
			}
			// Escape: Close panel
			if (e.key === "Escape") {
				e.preventDefault()
				onClose()
			}
		}

		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [isVisible, currentEdit, onClose, handleAccept, handleSkip, handleUndo])

	// Focus management: Focus accept button when edit loads
	useEffect(() => {
		if (isVisible && currentEdit && acceptButtonRef.current) {
			acceptButtonRef.current.focus()
		}
	}, [isVisible, currentEdit])

	const handleAccept = useCallback(() => {
		if (!currentEdit) return
		vscode.postMessage({ type: "nextEdit.accept" } as any)
	}, [currentEdit])

	const handleSkip = useCallback(() => {
		if (!currentEdit) return
		vscode.postMessage({ type: "nextEdit.skip" } as any)
	}, [currentEdit])

	const handleUndo = useCallback(() => {
		vscode.postMessage({ type: "nextEdit.undo" } as any)
	}, [])

	if (!isVisible) return null

	return (
		<div
			ref={panelRef}
			className="fixed inset-0 top-auto z-50 flex flex-col bg-[var(--vscode-sideBar-background)] border-t border-[var(--vscode-panel-border)] animate-slide-in-right"
			role="dialog"
			aria-modal="true"
			aria-labelledby="next-edit-title"
			aria-describedby={currentEdit ? "next-edit-rationale" : "next-edit-status"}>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b border-[var(--vscode-panel-border)]">
				<div className="flex items-center gap-2">
					<FileCode className="w-5 h-5 text-[var(--vscode-foreground)]" aria-hidden="true" />
					<h2 id="next-edit-title" className="text-sm font-semibold text-[var(--vscode-foreground)]">
						Next Edit
					</h2>
					{progress && (
						<span className="text-xs text-[var(--vscode-descriptionForeground)]" aria-live="polite">
							{progress.current} / {progress.total} ({progress.percentage}%)
						</span>
					)}
				</div>
				<Button variant="ghost" size="sm" onClick={onClose} aria-label="Close Next Edit panel">
					<X className="w-4 h-4" aria-hidden="true" />
				</Button>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-auto p-4 scrollable" role="region" aria-live="polite">
				{isLoading ? (
					<div
						className="flex items-center justify-center h-full text-[var(--vscode-descriptionForeground)]"
						role="status"
						aria-live="polite">
						<div className="animate-pulse">Loading next edit...</div>
					</div>
				) : currentEdit ? (
					<div className="space-y-4">
						{/* File Path */}
						<div className="flex items-center gap-2 text-sm text-[var(--vscode-foreground)]">
							<FileCode className="w-4 h-4" aria-hidden="true" />
							<span className="font-mono" aria-label={`File: ${currentEdit.filePath}`}>
								{currentEdit.filePath}
							</span>
						</div>

						{/* Rationale */}
						<div className="p-3 bg-[var(--vscode-editor-selectionBackground)] rounded-md">
							<p id="next-edit-rationale" className="text-sm text-[var(--vscode-editor-foreground)]">
								{currentEdit.rationale}
							</p>
						</div>

						{/* Diff View */}
						<div
							className="border border-[var(--vscode-panel-border)] rounded-md overflow-hidden"
							role="region"
							aria-label="Code changes diff">
							<div className="bg-[var(--vscode-editorGroupHeader-background)] px-3 py-2 text-xs text-[var(--vscode-sideBarSectionHeader-foreground)]">
								Diff
							</div>
							<div className="p-3 font-mono text-xs max-h-64 overflow-auto diff-view" tabIndex={0}>
								<pre className="whitespace-pre-wrap" aria-label="Code diff view">
									{currentEdit.originalContent !== currentEdit.newContent ? (
										<>
											<div
												className="diff-content-removed px-2 py-1"
												role="text"
												aria-label="Removed code">
												{currentEdit.originalContent}
											</div>
											<div
												className="diff-content-inserted px-2 py-1"
												role="text"
												aria-label="Added code">
												{currentEdit.newContent}
											</div>
										</>
									) : (
										<div className="text-[var(--vscode-descriptionForeground)]">No changes</div>
									)}
								</pre>
							</div>
						</div>

						{/* Context */}
						{currentEdit.context && (
							<div
								className="border border-[var(--vscode-panel-border)] rounded-md overflow-hidden"
								role="region"
								aria-label="Code context">
								<div className="bg-[var(--vscode-editorGroupHeader-background)] px-3 py-2 text-xs text-[var(--vscode-sideBarSectionHeader-foreground)]">
									Context
								</div>
								<div className="p-3 text-xs space-y-2">
									{currentEdit.context.before && (
										<div>
											<div className="text-[var(--vscode-descriptionForeground)] mb-1">
												Before:
											</div>
											<pre
												className="whitespace-pre-wrap text-[var(--vscode-editor-foreground)]"
												aria-label="Code before the edit">
												{currentEdit.context.before}
											</pre>
										</div>
									)}
									{currentEdit.context.after && (
										<div>
											<div className="text-[var(--vscode-descriptionForeground)] mb-1">
												After:
											</div>
											<pre
												className="whitespace-pre-wrap text-[var(--vscode-editor-foreground)]"
												aria-label="Code after the edit">
												{currentEdit.context.after}
											</pre>
										</div>
									)}
								</div>
							</div>
						)}
					</div>
				) : (
					<div
						id="next-edit-status"
						className="flex items-center justify-center h-full text-[var(--vscode-descriptionForeground)]"
						role="status">
						<div>No active edit</div>
					</div>
				)}
			</div>

			{/* Footer with Progress Bar */}
			{progress && (
				<div className="border-t border-[var(--vscode-panel-border)]">
					{/* Progress Bar */}
					<div className="h-1 bg-[var(--vscode-editorGroup-border)]">
						<div
							className="h-full bg-[var(--vscode-button-background)] transition-all duration-300"
							style={{ width: `${progress.percentage}%` }}
						/>
					</div>

					{/* Action Buttons */}
					<div className="flex items-center justify-between px-4 py-3">
						<div className="flex items-center gap-2 text-xs text-[var(--vscode-descriptionForeground)]">
							<span>{progress.completed} accepted</span>
							<span>•</span>
							<span>{progress.skipped} skipped</span>
							<span>•</span>
							<span>{progress.remaining} remaining</span>
						</div>

						<div className="flex items-center gap-2">
							<Button
								variant="secondary"
								size="sm"
								onClick={handleUndo}
								disabled={!currentEdit}
								className="gap-1">
								<Undo className="w-4 h-4" />
								Undo
							</Button>
							<Button
								variant="secondary"
								size="sm"
								onClick={handleSkip}
								disabled={!currentEdit}
								className="gap-1">
								<X className="w-4 h-4" />
								Skip
							</Button>
							<Button variant="primary" onClick={handleAccept} disabled={!currentEdit} className="gap-1">
								<Check className="w-4 h-4" />
								Accept
							</Button>
						</div>
					</div>
				</div>
			)}

			{/* Keyboard Shortcuts Hint */}
			<div className="px-4 py-2 border-t border-[var(--vscode-panel-border)] bg-[var(--vscode-editorGroupHeader-background)]">
				<div className="flex items-center justify-center gap-4 text-xs text-[var(--vscode-descriptionForeground)]">
					<span className="flex items-center gap-1">
						<kbd className="px-1.5 py-0.5 bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded text-[var(--vscode-editor-foreground)]">
							Ctrl+Enter
						</kbd>
						Accept
					</span>
					<span className="flex items-center gap-1">
						<kbd className="px-1.5 py-0.5 bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded text-[var(--vscode-editor-foreground)]">
							Ctrl+Shift+Enter
						</kbd>
						Skip
					</span>
					<span className="flex items-center gap-1">
						<kbd className="px-1.5 py-0.5 bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded text-[var(--vscode-editor-foreground)]">
							Ctrl+Z
						</kbd>
						Undo
					</span>
				</div>
			</div>
		</div>
	)
}
