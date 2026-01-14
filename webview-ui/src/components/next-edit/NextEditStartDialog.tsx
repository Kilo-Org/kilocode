/**
 * Next Edit Start Dialog Component
 *
 * Allows users to start a new Next Edit session by providing a goal
 * and optional configuration options (include/exclude patterns, max files).
 *
 * @module NextEditStartDialog
 */

import React, { useState, useRef, useEffect, useCallback } from "react"
import { vscode } from "../../utils/vscode"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { X, Play } from "lucide-react"

interface NextEditStartDialogProps {
	isOpen: boolean
	onClose: () => void
}

/**
 * Next Edit Start Dialog Component
 */
export const NextEditStartDialog: React.FC<NextEditStartDialogProps> = ({ isOpen, onClose }) => {
	const [goal, setGoal] = useState("")
	const [includePatterns, setIncludePatterns] = useState("")
	const [excludePatterns, setExcludePatterns] = useState("")
	const [maxFiles, setMaxFiles] = useState("")
	const goalInputRef = useRef<HTMLInputElement>(null)
	const cancelButtonRef = useRef<HTMLButtonElement>(null)

	const handleStart = useCallback(() => {
		if (!goal.trim()) {
			return
		}

		const params: {
			goal: string
			includePatterns?: string[]
			excludePatterns?: string[]
			maxFiles?: number
		} = {
			goal: goal.trim(),
		}

		if (includePatterns.trim()) {
			params.includePatterns = includePatterns
				.split(",")
				.map((p) => p.trim())
				.filter((p) => p.length > 0)
		}

		if (excludePatterns.trim()) {
			params.excludePatterns = excludePatterns
				.split(",")
				.map((p) => p.trim())
				.filter((p) => p.length > 0)
		}

		if (maxFiles.trim()) {
			const parsed = parseInt(maxFiles.trim(), 10)
			if (!isNaN(parsed) && parsed > 0) {
				params.maxFiles = parsed
			}
		}

		vscode.postMessage({
			type: "nextEdit.start",
			...params,
		} as any)

		onClose()
		setGoal("")
		setIncludePatterns("")
		setExcludePatterns("")
		setMaxFiles("")
	}, [goal, includePatterns, excludePatterns, maxFiles, onClose])

	// Focus management: Focus goal input when dialog opens
	useEffect(() => {
		if (isOpen && goalInputRef.current) {
			goalInputRef.current.focus()
		}
	}, [isOpen])

	// Handle keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (!isOpen) return

			// Escape: Close dialog
			if (e.key === "Escape") {
				e.preventDefault()
				onClose()
			}
			// Ctrl+Enter: Start session
			else if (e.ctrlKey && e.key === "Enter") {
				e.preventDefault()
				if (goal.trim()) {
					handleStart()
				}
			}
		}

		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [isOpen, goal, onClose, handleStart])

	if (!isOpen) return null

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in"
			role="dialog"
			aria-modal="true"
			aria-labelledby="start-dialog-title"
			aria-describedby="start-dialog-description">
			<div className="bg-[var(--vscode-sideBar-background)] border border-[var(--vscode-panel-border)] rounded-lg shadow-lg w-full max-w-md mx-4 animate-slide-in-right">
				{/* Header */}
				<div className="flex items-center justify-between px-6 py-4 border-b border-[var(--vscode-panel-border)]">
					<div className="flex items-center gap-2">
						<Play className="w-5 h-5 text-[var(--vscode-foreground)]" aria-hidden="true" />
						<h2 id="start-dialog-title" className="text-lg font-semibold text-[var(--vscode-foreground)]">
							Start Next Edit
						</h2>
					</div>
					<Button ref={cancelButtonRef} variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
						<X className="w-4 h-4" aria-hidden="true" />
					</Button>
				</div>

				{/* Content */}
				<div className="p-6 space-y-4">
					{/* Goal */}
					<div className="space-y-2">
						<label htmlFor="goal" className="block text-sm font-medium text-[var(--vscode-foreground)]">
							Goal <span className="text-[var(--vscode-errorForeground)]">*</span>
						</label>
						<Input
							id="goal"
							value={goal}
							onChange={(e) => setGoal(e.target.value)}
							placeholder="Describe what you want to achieve..."
							className="w-full"
							autoFocus
						/>
					</div>

					{/* Include Patterns */}
					<div className="space-y-2">
						<label htmlFor="include" className="block text-sm font-medium text-[var(--vscode-foreground)]">
							Include Patterns (optional)
						</label>
						<Input
							id="include"
							value={includePatterns}
							onChange={(e) => setIncludePatterns(e.target.value)}
							placeholder="*.ts,*.tsx,src/**/*"
							className="w-full"
						/>
						<p className="text-xs text-[var(--vscode-descriptionForeground)]">
							Comma-separated file patterns to include
						</p>
					</div>

					{/* Exclude Patterns */}
					<div className="space-y-2">
						<label htmlFor="exclude" className="block text-sm font-medium text-[var(--vscode-foreground)]">
							Exclude Patterns (optional)
						</label>
						<Input
							id="exclude"
							value={excludePatterns}
							onChange={(e) => setExcludePatterns(e.target.value)}
							placeholder="node_modules/**,dist/**,*.test.ts"
							className="w-full"
						/>
						<p className="text-xs text-[var(--vscode-descriptionForeground)]">
							Comma-separated file patterns to exclude
						</p>
					</div>

					{/* Max Files */}
					<div className="space-y-2">
						<label htmlFor="maxFiles" className="block text-sm font-medium text-[var(--vscode-foreground)]">
							Max Files (optional)
						</label>
						<Input
							id="maxFiles"
							type="number"
							value={maxFiles}
							onChange={(e) => setMaxFiles(e.target.value)}
							placeholder="100"
							className="w-full"
						/>
						<p className="text-xs text-[var(--vscode-descriptionForeground)]">
							Maximum number of files to analyze
						</p>
					</div>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--vscode-panel-border)]">
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button variant="primary" onClick={handleStart} disabled={!goal.trim()}>
						Start Session
					</Button>
				</div>
			</div>
		</div>
	)
}
