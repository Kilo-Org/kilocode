import { memo, useState, useMemo } from "react"
import { ChevronDown, Copy, Check, Loader2, Terminal } from "lucide-react"
import { useTranslation } from "react-i18next"
import { COMMAND_OUTPUT_STRING } from "@roo/combineCommandSequences"
import { cn } from "../../../lib/utils"

type CommandStatus = "running" | "success" | "error" | "unknown"

interface CommandExecutionBlockProps {
	text: string
	isRunning?: boolean
}

/**
 * Parses the combined command+output text into separate parts.
 * The format is: "command\nOutput:\noutput_text"
 */
function parseCommandAndOutput(text: string | undefined): { command: string; output: string } {
	if (!text) {
		return { command: "", output: "" }
	}

	const index = text.indexOf(COMMAND_OUTPUT_STRING)

	if (index === -1) {
		return { command: text, output: "" }
	}

	return {
		command: text.slice(0, index).trim(),
		output: text.slice(index + COMMAND_OUTPUT_STRING.length).trim(),
	}
}

/**
 * Detect if output indicates an error based on common error patterns.
 */
function detectErrorInOutput(output: string): boolean {
	if (!output) return false
	const lowerOutput = output.toLowerCase()
	// Common error indicators
	const errorPatterns = [
		"error:",
		"error ",
		"fatal:",
		"fatal ",
		"failed",
		"command not found",
		"no such file",
		"permission denied",
		"cannot ",
		"unable to",
		"exception",
		"traceback",
		"segmentation fault",
		"panic:",
	]
	return errorPatterns.some((pattern) => lowerOutput.includes(pattern))
}

export const CommandExecutionBlock = memo(({ text, isRunning = false }: CommandExecutionBlockProps) => {
	const { t } = useTranslation("agentManager")
	const { command, output } = useMemo(() => parseCommandAndOutput(text), [text])
	const [isExpanded, setIsExpanded] = useState(true)
	const [copied, setCopied] = useState(false)

	const hasOutput = output.length > 0
	const hasError = useMemo(() => detectErrorInOutput(output), [output])

	// Determine status
	const status: CommandStatus = useMemo(() => {
		if (isRunning && !hasOutput) return "running"
		if (hasOutput && hasError) return "error"
		if (hasOutput) return "success"
		return "unknown" // No output, not running - we don't know the status
	}, [isRunning, hasOutput, hasError])

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(command)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		} catch {
			// Clipboard API may fail in some contexts
		}
	}

	return (
		<div className="bg-vscode-editor-background border border-vscode-panel-border rounded-sm font-mono text-sm">
			{/* Header with status */}
			<div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-vscode-panel-border">
				<div className="flex items-center gap-2">
					<StatusIndicator status={status} />
					<span className="text-xs text-vscode-descriptionForeground">
						{status === "running" && t("messages.running")}
						{status === "success" && t("messages.completed")}
						{status === "error" && t("messages.error")}
						{status === "unknown" && <Terminal size={12} className="opacity-50" />}
					</span>
				</div>
				<div className="flex items-center gap-1">
					<button
						onClick={handleCopy}
						className="p-1 text-vscode-descriptionForeground hover:text-vscode-foreground transition-colors rounded hover:bg-vscode-toolbar-hoverBackground"
						title={t("messages.copyCommand")}>
						{copied ? <Check size={14} /> : <Copy size={14} />}
					</button>
					{hasOutput && (
						<button
							onClick={() => setIsExpanded(!isExpanded)}
							className="p-1 text-vscode-descriptionForeground hover:text-vscode-foreground transition-colors rounded hover:bg-vscode-toolbar-hoverBackground"
							title={isExpanded ? t("messages.collapseOutput") : t("messages.expandOutput")}>
							<ChevronDown
								className={cn("size-4 transition-transform duration-200", isExpanded && "rotate-180")}
							/>
						</button>
					)}
				</div>
			</div>

			{/* Command */}
			<div className="p-2">
				<pre className="overflow-x-auto whitespace-pre-wrap break-all m-0 p-0">{command}</pre>
			</div>

			{/* Output */}
			{hasOutput && (
				<div
					className={cn("overflow-hidden transition-all duration-200 border-t border-vscode-panel-border", {
						"max-h-0 border-t-0": !isExpanded,
						"max-h-[500px] overflow-y-auto": isExpanded,
					})}>
					<div className={cn("p-2", hasError ? "bg-red-500/5" : "bg-black/5")}>
						<pre
							className={cn(
								"overflow-x-auto whitespace-pre-wrap break-all m-0 p-0 text-xs",
								hasError ? "text-red-400" : "text-vscode-descriptionForeground",
							)}>
							{output}
						</pre>
					</div>
				</div>
			)}
		</div>
	)
})

CommandExecutionBlock.displayName = "CommandExecutionBlock"

/**
 * Status indicator dot/spinner
 */
function StatusIndicator({ status }: { status: CommandStatus }) {
	switch (status) {
		case "running":
			return <Loader2 size={12} className="animate-spin text-blue-400" />
		case "success":
			return <div className="size-2.5 rounded-full bg-green-500" />
		case "error":
			return <div className="size-2.5 rounded-full bg-red-500" />
		default:
			return <div className="size-2.5 rounded-full bg-vscode-descriptionForeground/30" />
	}
}
