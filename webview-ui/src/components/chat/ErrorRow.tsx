import React, { useState, useCallback, memo } from "react"
import { useTranslation } from "react-i18next"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { BookOpenText, MessageCircleWarning } from "lucide-react"
import { useCopyToClipboard } from "@src/utils/clipboard"
import { vscode } from "@src/utils/vscode"
import CodeBlock from "../kilocode/common/CodeBlock" // kilocode_change
import { Button } from "@src/components/ui" // kilocode_change

/**
 * Unified error display component for all error types in the chat.
 * Provides consistent styling, icons, and optional documentation links across all errors.
 *
 * @param type - Error type determines icon and default title
 * @param title - Optional custom title (overrides default for error type)
 * @param message - Error message text (required)
 * @param docsURL - Optional documentation link URL (shown as "Learn more" with book icon)
 * @param showCopyButton - Whether to show copy button for error message
 * @param expandable - Whether error content can be expanded/collapsed
 * @param defaultExpanded - Whether expandable content starts expanded
 * @param additionalContent - Optional React nodes to render after message
 * @param headerClassName - Custom CSS classes for header section
 * @param messageClassName - Custom CSS classes for message section
 *
 * @example
 * // Simple error
 * <ErrorRow type="error" message="File not found" />
 *
 * @example
 * // Error with documentation link
 * <ErrorRow
 *   type="api_failure"
 *   message="API key missing"
 *   docsURL="https://docs.example.com/api-setup"
 * />
 *
 * @example
 * // Expandable error with code
 * <ErrorRow
 *   type="diff_error"
 *   message="Patch failed to apply"
 *   expandable={true}
 *   defaultExpanded={false}
 *   additionalContent={<pre>{errorDetails}</pre>}
 * />
 */
export interface ErrorRowProps {
	type:
		| "error"
		| "mistake_limit"
		| "api_failure"
		| "diff_error"
		| "streaming_failed"
		| "cancelled"
		| "api_req_retry_delayed"
	title?: string
	message: string
	showCopyButton?: boolean
	expandable?: boolean
	defaultExpanded?: boolean
	additionalContent?: React.ReactNode
	headerClassName?: string
	messageClassName?: string
	code?: number
	docsURL?: string // NEW: Optional documentation link
	showLoginButton?: boolean // kilocode_change
	onLoginClick?: () => void // kilocode_change
}

/**
 * Unified error display component for all error types in the chat
 */
export const ErrorRow = memo(
	({
		type,
		title,
		message,
		showCopyButton = false,
		expandable = false,
		defaultExpanded = false,
		additionalContent,
		headerClassName,
		messageClassName,
		docsURL,
		code,
		showLoginButton = false, // kilocode_change
		onLoginClick, // kilocode_change
	}: ErrorRowProps) => {
		const { t } = useTranslation()
		const [isExpanded, setIsExpanded] = useState(defaultExpanded)
		const [showCopySuccess, setShowCopySuccess] = useState(false)
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
				case "api_req_retry_delayed":
					return t("chat:apiRequest.errorTitle", { code: code ? ` · ${code}` : "" })
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

		const errorTitle = getDefaultTitle()

		// For diff_error type with expandable content
		if (type === "diff_error" && expandable) {
			return (
				<div className="mt-0 overflow-hidden mb-2 pr-1 group">
					<div
						className="font-sm text-vscode-editor-foreground flex items-center justify-between cursor-pointer"
						onClick={handleToggleExpand}>
						<div className="flex items-center gap-2 flex-grow  text-vscode-errorForeground">
							<MessageCircleWarning className="w-4" />
							<span className="text-vscode-errorForeground font-bold grow cursor-pointer">
								{errorTitle}
							</span>
						</div>
						<div className="flex items-center transition-opacity opacity-0 group-hover:opacity-100">
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
						<div className="px-2 py-1 mt-2 bg-vscode-editor-background ml-6 rounded-lg">
							<CodeBlock source={message} language="xml" />
						</div>
					)}
				</div>
			)
		}

		// Standard error display
		return (
			<div className="group pr-2">
				{errorTitle && (
					<div className={headerClassName || "flex items-center justify-between gap-2 break-words"}>
						<MessageCircleWarning className="w-4 text-vscode-errorForeground" />
						<span className="text-vscode-errorForeground font-bold grow cursor-default">{errorTitle}</span>
						{docsURL && (
							<a
								href={docsURL}
								className="text-sm flex items-center gap-1 transition-opacity opacity-0 group-hover:opacity-100"
								onClick={(e) => {
									e.preventDefault()
									vscode.postMessage({ type: "openExternal", url: docsURL })
								}}>
								<BookOpenText className="size-3 mt-[3px]" />
								{t("chat:apiRequest.errorMessage.docs")}
							</a>
						)}
					</div>
				)}
				<div className="pl-6 py-1">
					<p
						className={
							messageClassName ||
							"my-0 font-light whitespace-pre-wrap break-words text-vscode-errorForeground"
						}>
						{message}
					</p>
					{/* kilocode_change start */}
					{showLoginButton && onLoginClick && (
						<div className="ml-6 mt-3">
							<Button variant="secondary" onClick={onLoginClick}>
								{t("kilocode:settings.provider.login")}
							</Button>
						</div>
					)}
					{/* kilocode_change end */}
					{additionalContent}
				</div>
			</div>
		)
	},
)

export default ErrorRow
