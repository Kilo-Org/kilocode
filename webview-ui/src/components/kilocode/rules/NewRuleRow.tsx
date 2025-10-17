import { useState, useRef, useEffect } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useClickAway } from "react-use"
import { useTranslation } from "react-i18next"
import { vscode } from "@/utils/vscode"
import { getExtension } from "@/utils/kilocode/path-webview"
import { allowedExtensions } from "@roo/kilocode/rules"

interface NewRuleRowProps {
	isGlobal: boolean
	ruleType: "rule" | "workflow"
}

const NewRuleRow: React.FC<NewRuleRowProps> = ({ isGlobal, ruleType }) => {
	const { t } = useTranslation()
	const [isExpanded, setIsExpanded] = useState(false)
	const [filename, setFilename] = useState("")
	const inputRef = useRef<HTMLInputElement>(null)
	const [error, setError] = useState<string | null>(null)

	const componentRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (isExpanded && inputRef.current) {
			inputRef.current.focus()
		}
	}, [isExpanded])

	useClickAway(componentRef, () => {
		if (isExpanded) {
			setIsExpanded(false)
			setFilename("")
			setError(null)
		}
	})

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		if (filename.trim()) {
			const trimmedFilename = filename.trim()
			const extension = getExtension(trimmedFilename)

			if (extension !== "" && !allowedExtensions.includes(extension)) {
				setError(t("kilocode:rules.validation.invalidFileExtension"))
				return
			}

			let finalFilename = trimmedFilename
			if (extension === "") {
				finalFilename = `${trimmedFilename}.md`
			}
			try {
				vscode.postMessage({
					type: "createRuleFile",
					isGlobal,
					filename: finalFilename,
					ruleType: ruleType,
				})
			} catch (err) {
				console.error("Error creating rule file:", err)
			}
			setFilename("")
			setError(null)
			setIsExpanded(false)
		}
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			setIsExpanded(false)
			setFilename("")
		}
	}

	return (
		<div
			ref={componentRef}
			className={`mb-2.5 transition-all duration-300 ease-in-out ${isExpanded ? "opacity-100" : "opacity-70 hover:opacity-100"}`}
			onClick={() => !isExpanded && setIsExpanded(true)}>
			<div
				className={`flex items-center p-2 rounded bg-[var(--vscode-input-background)] transition-all duration-300 ease-in-out h-[18px] ${
					isExpanded ? "shadow-sm" : ""
				}`}>
				{isExpanded ? (
					<form onSubmit={handleSubmit} className="flex flex-1 items-center">
						<input
							ref={inputRef}
							type="text"
							placeholder={
								ruleType === "workflow"
									? t("kilocode:rules.placeholders.workflowName")
									: t("kilocode:rules.placeholders.ruleName")
							}
							value={filename}
							onChange={(e) => setFilename(e.target.value)}
							onKeyDown={handleKeyDown}
							className="flex-1 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border-0 outline-0 rounded focus:outline-none focus:ring-0 focus:border-transparent"
							style={{
								outline: "none",
							}}
						/>

						<div className="flex items-center ml-2 space-x-2">
							<VSCodeButton
								appearance="icon"
								type="submit"
								aria-label="Create rule file"
								title="Create rule file"
								style={{ padding: "0px" }}>
								<span className="codicon codicon-add text-[14px]" />
							</VSCodeButton>
						</div>
					</form>
				) : (
					<>
						<span className="flex-1 text-[var(--vscode-descriptionForeground)] bg-[var(--vscode-input-background)] italic text-xs">
							{ruleType === "workflow"
								? t("kilocode:rules.newFile.newWorkflowFile")
								: t("kilocode:rules.newFile.newRuleFile")}
						</span>
						<div className="flex items-center ml-2 space-x-2">
							<VSCodeButton
								appearance="icon"
								aria-label="New rule file"
								title="New rule file"
								onClick={(e) => {
									e.stopPropagation()
									setIsExpanded(true)
								}}
								style={{ padding: "0px" }}>
								<span className="codicon codicon-add text-[14px]" />
							</VSCodeButton>
						</div>
					</>
				)}
			</div>
			{isExpanded && error && (
				<div className="text-[var(--vscode-errorForeground)] text-xs mt-1 ml-2">{error}</div>
			)}
		</div>
	)
}

export default NewRuleRow
