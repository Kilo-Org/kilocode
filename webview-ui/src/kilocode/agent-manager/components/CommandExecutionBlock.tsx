import { memo, useState, useMemo } from "react"
import { ChevronDown, Copy, Check, Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { COMMAND_OUTPUT_STRING } from "@roo/combineCommandSequences"
import { cn } from "../../../lib/utils"

type CommandStatus = "pending" | "running" | "success" | "error"

interface CommandExecutionBlockProps {
	text: string
	isRunning?: boolean
	isLast?: boolean
	exitCode?: number
	terminalStatus?: string
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

	let output = text.slice(index + COMMAND_OUTPUT_STRING.length)

	// `combineCommandSequences` adds "\nOutput:" before output; real output often starts with a newline.
	output = output.replace(/^\n/, "")

	// Clean up output - remove leading "command_output" lines that may appear from message parsing
	const lines = output.split("\n")
	const cleanedLines = lines.filter((line) => line.trim() !== "command_output")
	output = cleanedLines.join("\n").replace(/\n+$/, "")

	return {
		command: text.slice(0, index).trim(),
		output,
	}
}

/**
 * Strip terminal escape sequences and non-printable control characters.
 * This prevents "blank" outputs caused by ANSI control codes.
 */
function sanitizeOutput(raw: string): string {
	if (!raw) return ""

	// OSC: ESC ] ... BEL  OR  ESC ] ... ESC \
	// eslint-disable-next-line no-control-regex
	const withoutOsc = raw.replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
	// CSI: ESC [ ... command
	// eslint-disable-next-line no-control-regex
	const withoutCsi = withoutOsc.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
	// Other stray ESC sequences
	// eslint-disable-next-line no-control-regex
	const withoutEsc = withoutCsi.replace(/\u001B./g, "")

	// Remove control chars except \t, \n, \r
	// eslint-disable-next-line no-control-regex
	return withoutEsc.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
}

export const CommandExecutionBlock = memo(
	({ text, isRunning = false, isLast = false, exitCode, terminalStatus }: CommandExecutionBlockProps) => {
		const { t } = useTranslation("agentManager")
		const { command, output: rawOutput } = useMemo(() => parseCommandAndOutput(text), [text])
		const [isExpanded, setIsExpanded] = useState(true)
		const [copied, setCopied] = useState(false)

		const output = useMemo(() => sanitizeOutput(rawOutput), [rawOutput])
		const hasOutput = useMemo(() => /\S/.test(output), [output])
		const hasOutputMarker = useMemo(() => text.indexOf(COMMAND_OUTPUT_STRING) !== -1, [text])
		const isCompleted = exitCode !== undefined || terminalStatus === "timeout" || terminalStatus === "exited"

		// Determine status - deterministic based on exit code
		const status: CommandStatus = useMemo(() => {
			// Running: has output marker but no output yet, only for the most recent command
			if (!isCompleted && (isRunning || (hasOutputMarker && isLast)) && !hasOutput) {
				return "running"
			}
			// Error: timeout or non-zero exit code
			if (terminalStatus === "timeout" || (exitCode !== undefined && exitCode !== 0)) {
				return "error"
			}
			// Success: zero exit code, has output, or has output marker (executed but no visible output)
			if (exitCode === 0 || hasOutput || hasOutputMarker) {
				return "success"
			}
			// Pending: waiting for approval/execution
			return "pending"
		}, [isCompleted, isRunning, hasOutputMarker, isLast, hasOutput, terminalStatus, exitCode])

		const isError = status === "error"

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
				{/* Header with status and command */}
				<div className="flex items-center justify-between gap-2 px-2 py-1.5">
					<div className="flex items-center gap-2 min-w-0 flex-1">
						<StatusIndicator status={status} />
						<pre className="overflow-x-auto whitespace-pre m-0 p-0 flex-1 min-w-0">{command}</pre>
					</div>
					<div className="flex items-center gap-1 flex-shrink-0">
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
									className={cn(
										"size-4 transition-transform duration-200",
										isExpanded && "rotate-180",
									)}
								/>
							</button>
						)}
					</div>
				</div>

				{/* Output */}
				{hasOutput && (
					<div
						className={cn(
							"overflow-hidden transition-all duration-200 border-t border-vscode-panel-border",
							{
								"max-h-0 border-t-0": !isExpanded,
								"max-h-[500px] overflow-y-auto": isExpanded,
							},
						)}>
						<div className="p-2 bg-vscode-editor-background">
							<pre
								className={cn(
									"overflow-x-auto whitespace-pre m-0 p-0 text-xs",
									isError ? "text-red-400" : "text-vscode-descriptionForeground",
								)}>
								{output}
							</pre>
						</div>
					</div>
				)}
			</div>
		)
	},
)

CommandExecutionBlock.displayName = "CommandExecutionBlock"

/**
 * Status indicator dot/spinner
 */
function StatusIndicator({ status }: { status: CommandStatus }) {
	switch (status) {
		case "pending":
			return <div className="size-2 rounded-full bg-yellow-500/70 flex-shrink-0" />
		case "running":
			return <Loader2 size={10} className="animate-spin text-blue-400 flex-shrink-0" />
		case "success":
			return <div className="size-2 rounded-full bg-green-500 flex-shrink-0" />
		case "error":
			return <div className="size-2 rounded-full bg-red-500 flex-shrink-0" />
	}
}
