import { FolderOpen, GitBranch } from "lucide-react"
import { Button } from "@src/components/ui"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { Tab, TabContent } from "../../common/Tab"
import RooHero from "../RooHero"
import { FunProjectSuggestions } from "../components/FunProjectSuggestions"

export const NoFolderNoHistoryScreen = () => {
	const { t } = useAppTranslation()

	const handleOpenFolder = () => {
		vscode.postMessage({ type: "openFolder" })
	}

	const handleCloneRepository = () => {
		vscode.postMessage({ type: "showCloneDialog" })
	}

	return (
		<Tab>
			<TabContent className="flex flex-col gap-4 p-6">
				<RooHero />
				<h2 className="text-xl font-semibold mt-0 mb-0">{t("welcome:noFolderNoHistory.heading")}</h2>

				<p className="text-base text-vscode-descriptionForeground">
					{t("welcome:noFolderNoHistory.description")}
				</p>

				{/* Primary Actions - Highlighted */}
				<div className="flex flex-col gap-2">
					<Button onClick={handleOpenFolder} variant="primary" className="w-full justify-start">
						<FolderOpen className="size-4 mr-2" />
						{t("welcome:noFolderNoHistory.openFolder")}
					</Button>
					<Button onClick={handleCloneRepository} variant="primary" className="w-full justify-start">
						<GitBranch className="size-4 mr-2" />
						{t("welcome:noFolderNoHistory.cloneRepository")}
					</Button>
				</div>

				{/* Secondary Actions - Fun Projects */}
				<FunProjectSuggestions />
			</TabContent>
		</Tab>
	)
}
