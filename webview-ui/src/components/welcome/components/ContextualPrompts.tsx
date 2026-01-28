// kilocode_change - new file
import { useEffect, useState } from "react"
import { FolderTree, Bug, TestTube, Sparkles, FileText } from "lucide-react"
import { Button } from "@src/components/ui"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

export const ContextualPrompts = () => {
	const { t } = useAppTranslation()
	const [hasOpenFile, setHasOpenFile] = useState(false)
	const [hasSelectedCode, setHasSelectedCode] = useState(false)

	useEffect(() => {
		// Check editor state on mount
		vscode.postMessage({ type: "checkEditorState" })

		// Listen for editor state updates
		const handler = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "editorState") {
				setHasOpenFile(message.hasOpenFile)
				setHasSelectedCode(message.hasSelectedCode)
			}
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	const handlePromptClick = (prompt: string) => {
		vscode.postMessage({
			type: "newTask",
			text: prompt,
		})
	}

	// Build contextual prompts based on editor state
	const prompts = [
		{
			text: t("welcome:folderNoHistory.prompts.explainStructure"),
			icon: FolderTree,
			condition: true,
		},
		{
			text: t("welcome:folderNoHistory.prompts.findBugs"),
			icon: Bug,
			condition: hasOpenFile,
		},
		{
			text: t("welcome:folderNoHistory.prompts.writeTests"),
			icon: TestTube,
			condition: hasSelectedCode,
		},
		{
			text: t("welcome:folderNoHistory.prompts.improveCode"),
			icon: Sparkles,
			condition: true,
		},
		{
			text: t("welcome:folderNoHistory.prompts.addDocumentation"),
			icon: FileText,
			condition: true,
		},
	].filter((p) => p.condition)

	return (
		<div className="flex flex-col gap-3">
			{prompts.map((prompt, index) => {
				const Icon = prompt.icon
				return (
					<Button
						key={index}
						onClick={() => handlePromptClick(prompt.text)}
						variant="secondary"
						className="w-full justify-start py-5 hover:bg-vscode-list-hoverBackground transition-colors">
						<Icon className="size-5 mr-3 flex-shrink-0" />
						<span className="text-left text-base">{prompt.text}</span>
					</Button>
				)
			})}
		</div>
	)
}
