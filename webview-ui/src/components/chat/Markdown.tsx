import { memo, useState, useMemo } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import { useCopyToClipboard } from "@src/utils/clipboard"
import { StandardTooltip } from "@src/components/ui"
import { getTextDirection } from "@src/utils/textDirection" // kilocode_change: RTL support
import { sanitizeToolTags } from "@src/utils/sanitizeToolTags" // kilocode_change: sanitize raw tool tags

import MarkdownBlock from "../common/MarkdownBlock"

export const Markdown = memo(({ markdown, partial }: { markdown?: string; partial?: boolean }) => {
	const [isHovering, setIsHovering] = useState(false)

	// Shorter feedback duration for copy button flash.
	const { copyWithFeedback } = useCopyToClipboard(200)

	// kilocode_change start: Sanitize raw tool tags from AI responses
	const sanitizedMarkdown = useMemo(() => sanitizeToolTags(markdown), [markdown])
	// kilocode_change end

	// kilocode_change: Detect RTL text direction for Arabic and other RTL languages
	const textDirection = useMemo(() => getTextDirection(sanitizedMarkdown), [sanitizedMarkdown])

	if (!sanitizedMarkdown || sanitizedMarkdown.length === 0) {
		return null
	}

	return (
		<div
			onMouseEnter={() => setIsHovering(true)}
			onMouseLeave={() => setIsHovering(false)}
			style={{
				position: "relative",
				direction: textDirection,
				textAlign: textDirection === "rtl" ? "right" : "left",
			}}>
			<div style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
				<MarkdownBlock markdown={sanitizedMarkdown} />
			</div>
			{sanitizedMarkdown && !partial && isHovering && (
				<div
					style={{
						position: "absolute",
						bottom: "-4px",
						right: textDirection === "rtl" ? "auto" : "8px",
						left: textDirection === "rtl" ? "8px" : "auto",
						opacity: 0,
						animation: "fadeIn 0.2s ease-in-out forwards",
						borderRadius: "4px",
					}}>
					<style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1.0; } }`}</style>
					<StandardTooltip content="Copy as markdown">
						<VSCodeButton
							className="copy-button"
							appearance="icon"
							style={{
								height: "24px",
								border: "none",
								background: "var(--vscode-editor-background)",
								transition: "background 0.2s ease-in-out",
							}}
							onClick={async () => {
								const success = await copyWithFeedback(sanitizedMarkdown)
								if (success) {
									const button = document.activeElement as HTMLElement
									if (button) {
										button.style.background = "var(--vscode-button-background)"
										setTimeout(() => {
											button.style.background = ""
										}, 200)
									}
								}
							}}>
							<span className="codicon codicon-copy" />
						</VSCodeButton>
					</StandardTooltip>
				</div>
			)}
		</div>
	)
})
