import React, { useState, useCallback, memo, useRef, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { XCircle, Info } from "lucide-react"
import { useCopyToClipboard } from "@src/utils/clipboard"
import CodeBlock from "../kilocode/common/CodeBlock" // kilocode_change

export interface ErrorRowProps {
	type: "error" | "mistake_limit" | "api_failure" | "diff_error" | "streaming_failed" | "cancelled"
	title?: string
	message: string
	context?: string // Optional context like file name
	showCopyButton?: boolean
	expandable?: boolean
	defaultExpanded?: boolean
	additionalContent?: React.ReactNode
	headerClassName?: string
	messageClassName?: string
}

/**
 * Unified error display component for all error types in the chat
 * Displays a compact single-line error with an info icon that shows details on hover
 */
export const ErrorRow = memo(
	({
		type,
		title,
		message,
		context,
		showCopyButton = false,
		expandable = false,
		defaultExpanded = false,
		additionalContent,
		headerClassName,
		// messageClassName,
	}: ErrorRowProps) => {
		const { t } = useTranslation()
		const [isExpanded, setIsExpanded] = useState(defaultExpanded)
		const [showCopySuccess, setShowCopySuccess] = useState(false)
		const [showTooltip, setShowTooltip] = useState(false)
		const tooltipRef = useRef<HTMLDivElement>(null)
		const infoIconRef = useRef<HTMLDivElement>(null)
		const { copyWithFeedback } = useCopyToClipboard()

		// Default titles for different error types
		const getDefaultTitle = () => {
			if (title) return title

			switch (type) {
				case "error":
					return t("chat:error")
				case "mistake_limit":
					return t("chat:troubleMessage")
				case "api_failure":
					return t("chat:apiRequest.failed")
				case "streaming_failed":
					return t("chat:apiRequest.streamingFailed")
				case "cancelled":
					return t("chat:apiRequest.cancelled")
				case "diff_error":
					return t("chat:diffError.title")
				default:
					return null
			}
		}

		const handleToggleExpand = useCallback(() => {
			if (expandable) {
				setIsExpanded(!isExpanded)
			}
		}, [expandable, isExpanded])

		const handleCopy = useCallback(
			async (e: React.MouseEvent) => {
				e.stopPropagation()
				const success = await copyWithFeedback(message)
				if (success) {
					setShowCopySuccess(true)
					setTimeout(() => {
						setShowCopySuccess(false)
					}, 1000)
				}
			},
			[message, copyWithFeedback],
		)

		// Close tooltip when clicking outside
		useEffect(() => {
			const handleClickOutside = (event: MouseEvent) => {
				if (
					tooltipRef.current &&
					!tooltipRef.current.contains(event.target as Node) &&
					infoIconRef.current &&
					!infoIconRef.current.contains(event.target as Node)
				) {
					setShowTooltip(false)
				}
			}

			if (showTooltip) {
				document.addEventListener("mousedown", handleClickOutside)
			}

			return () => {
				document.removeEventListener("mousedown", handleClickOutside)
			}
		}, [showTooltip])

		const errorTitle = getDefaultTitle()

		// Truncate message for display
		const truncateMessage = (msg: string, maxLength: number = 30) => {
			if (msg.length <= maxLength) return msg
			return msg.substring(0, maxLength) + "..."
		}

		// For diff_error type with expandable content
		if (type === "diff_error" && expandable) {
			return (
				<div className="overflow-hidden mb-2 mt-2">
					<div
						className={`font-normal rounded-lg text-vscode-editor-foreground flex items-center justify-between cursor-pointer ${
							isExpanded ? "border-b border-vscode-editorGroup-border" : ""
						}`}
						onClick={handleToggleExpand}>
						<div className="flex items-center gap-2 flex-grow">
							<XCircle className="w-3 h-3 text-vscode-foreground opacity-50" />
							<span className="font-bold">{errorTitle}</span>
						</div>
						<div className="flex items-center">
							{showCopyButton && (
								<VSCodeButton
									appearance="icon"
									className="p-0.75 h-6 mr-1 text-vscode-editor-foreground flex items-center justify-center bg-transparent"
									onClick={handleCopy}>
									<span className={`codicon codicon-${showCopySuccess ? "check" : "copy"}`} />
								</VSCodeButton>
							)}
							<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`} />
						</div>
					</div>
					{isExpanded && (
						<div className="p-2 bg-vscode-editor-background border-t-0">
							<CodeBlock source={message} language="xml" />
						</div>
					)}
				</div>
			)
		}

		// Compact single-line error display with info icon tooltip
		return (
			<div className="relative my-1">
				<div
					className={
						headerClassName || "flex items-center gap-2 py-1.5 px-2 rounded-md bg-vscode-editor-background"
					}>
					{/* Error Icon */}
					<XCircle className="w-4 h-4 flex-shrink-0 text-vscode-foreground opacity-50" />

					{/* Error Title */}
					{errorTitle && (
						<span className="text-vscode-editor-foreground font-medium text-sm whitespace-nowrap">
							{errorTitle}
						</span>
					)}

					{/* Context Badge (e.g., file name) */}
					{context && (
						<span className="px-1.5 py-0.5 text-xs rounded bg-vscode-badge-background text-vscode-badge-foreground font-mono whitespace-nowrap">
							{context}
						</span>
					)}

					{/* Truncated Message */}
					<span className="text-vscode-descriptionForeground text-sm truncate flex-1 min-w-0">
						{truncateMessage(message)}
					</span>

					{/* Info Icon with Tooltip */}
					<div
						ref={infoIconRef}
						className="flex-shrink-0 cursor-pointer p-1 rounded hover:bg-vscode-toolbar-hoverBackground transition-colors"
						onMouseEnter={() => setShowTooltip(true)}
						onMouseLeave={() => setShowTooltip(false)}
						onClick={() => setShowTooltip(!showTooltip)}>
						<Info className="w-4 h-4 text-vscode-descriptionForeground" />
					</div>
				</div>

				{/* Tooltip Popover */}
				{showTooltip && (
					<div
						ref={tooltipRef}
						className="absolute right-0 bottom-full mb-1 z-50 w-80 max-w-[90vw] p-3 rounded-lg shadow-lg border border-vscode-editorWidget-border bg-vscode-editor-background text-vscode-editor-foreground"
						style={{
							animation: "fadeIn 0.15s ease-out",
						}}>
						<p className="text-sm leading-relaxed whitespace-pre-wrap break-words m-0">{message}</p>

						{additionalContent && (
							<div className="mt-2 pt-2 border-t border-vscode-editorGroup-border">
								{additionalContent}
							</div>
						)}

						{showCopyButton && (
							<div className="mt-2 pt-2 border-t border-vscode-editorGroup-border flex justify-end">
								<VSCodeButton
									appearance="icon"
									className="p-1 h-6 text-vscode-editor-foreground flex items-center justify-center gap-1"
									onClick={handleCopy}>
									<span className={`codicon codicon-${showCopySuccess ? "check" : "copy"}`} />
									<span className="text-xs">{showCopySuccess ? "Copied" : "Copy"}</span>
								</VSCodeButton>
							</div>
						)}
					</div>
				)}

				<style>{`
					@keyframes fadeIn {
						from {
							opacity: 0;
							transform: translateY(-4px);
						}
						to {
							opacity: 1;
							transform: translateY(0);
						}
					}
				`}</style>
			</div>
		)
	},
)

export default ErrorRow
