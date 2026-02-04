import React from "react"
import { TriangleAlert, BookOpenText } from "lucide-react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

export interface WarningRowProps {
	title: string
	message: string
	docsURL?: string
	actionText?: string
	onAction?: () => void
}

/**
 * A generic warning row component that displays a warning icon, title, and message.
 * Optionally includes a documentation link and/or an action link.
 *
 * @param title - The warning title displayed in bold
 * @param message - The warning message displayed below the title
 * @param docsURL - Optional documentation link URL (shown as "Learn more" with book icon)
 * @param actionText - Optional text for an action link appended to the message
 * @param onAction - Optional callback when the action link is clicked
 *
 * @example
 * <WarningRow
 *   title="Too many tools enabled"
 *   message="You have 50 tools enabled via 5 MCP servers."
 *   docsURL="https://docs.example.com/mcp-best-practices"
 *   actionText="Open MCP Settings"
 *   onAction={() => openSettings()}
 * />
 */
export const WarningRow: React.FC<WarningRowProps> = ({ title, message, docsURL, actionText, onAction }) => {
	const { t } = useAppTranslation()

	return (
		<div className="group pr-2 py-2">
			<div className="flex items-center justify-between gap-2 break-words">
				<TriangleAlert className="w-4 text-vscode-editorWarning-foreground shrink-0" />
				<span className="font-bold text-vscode-editorWarning-foreground grow cursor-default">{title}</span>
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
			<div className="cursor-default ml-2 pl-4 mt-1 pt-0.5 border-l border-vscode-editorWarning-foreground/50">
				<p className="my-0 font-light whitespace-pre-wrap break-words text-vscode-descriptionForeground">
					{message}
					{actionText && onAction && (
						<>
							{" "}
							<a
								href="#"
								className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground cursor-pointer"
								onClick={(e) => {
									e.preventDefault()
									onAction()
								}}>
								{actionText}
							</a>
						</>
					)}
				</p>
			</div>
		</div>
	)
}

export default WarningRow
