// kilocode_change - new file
import { Gamepad2, ListTodo, Cloud } from "lucide-react"
import { Button } from "@src/components/ui"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

const FUN_PROJECTS = [
	{
		id: "snake",
		icon: Gamepad2,
		prompt: "Create a Snake game in HTML/CSS/JavaScript with arrow key controls and score tracking",
	},
	{
		id: "todo",
		icon: ListTodo,
		prompt: "Build a Todo app with React and TypeScript, including add/delete/complete functionality and local storage",
	},
	{
		id: "weather",
		icon: Cloud,
		prompt: "Make a Weather Dashboard using a weather API, showing current conditions and 5-day forecast with icons",
	},
]

export const FunProjectSuggestions = () => {
	const { t } = useAppTranslation()

	const handleProjectClick = (project: (typeof FUN_PROJECTS)[0]) => {
		vscode.postMessage({
			type: "newTask",
			text: project.prompt,
			funProject: project.id,
		})
	}

	return (
		<div className="mt-6">
			<div className="border-t border-vscode-panel-border pt-6">
				<p className="text-sm text-vscode-descriptionForeground mb-3 font-medium">
					{t("welcome:noFolderNoHistory.orTryFunProject")}
				</p>
				<div className="flex flex-col gap-2">
					{FUN_PROJECTS.map((project) => {
						const Icon = project.icon
						return (
							<Button
								key={project.id}
								onClick={() => handleProjectClick(project)}
								variant="secondary"
								className="w-full justify-start text-sm py-5 hover:bg-vscode-list-hoverBackground transition-colors">
								<Icon className="size-4 mr-3 flex-shrink-0" />
								<span className="text-left">
									{t(`welcome:noFolderNoHistory.projects.${project.id}`)}
								</span>
							</Button>
						)
					})}
				</div>
			</div>
		</div>
	)
}
