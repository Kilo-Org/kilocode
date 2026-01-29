// kilocode_change - new file
import { FolderOpen, GitBranch } from "lucide-react"
import { Button } from "@src/components/ui"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { Tab, TabContent } from "../../common/Tab"
import KiloHero from "../KiloHero"
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
			<TabContent className="flex flex-col gap-6 p-8 max-w-2xl mx-auto">
				<KiloHero />

				<div className="text-center space-y-3">
					<h1 className="text-2xl font-bold mt-0 mb-0">{t("welcome:noFolderNoHistory.heading")}</h1>
					<p className="text-base text-vscode-descriptionForeground leading-relaxed">
						{t("welcome:noFolderNoHistory.description")}
					</p>
				</div>

				{/* Primary Actions - Highlighted */}
				<div className="flex flex-col gap-3 mt-2">
					<Button
						onClick={handleOpenFolder}
						variant="primary"
						className="w-full justify-start py-6 text-base">
						<FolderOpen className="size-5 mr-3" />
						{t("welcome:noFolderNoHistory.openFolder")}
					</Button>
					<Button
						onClick={handleCloneRepository}
						variant="primary"
						className="w-full justify-start py-6 text-base">
						<GitBranch className="size-5 mr-3" />
						{t("welcome:noFolderNoHistory.cloneRepository")}
					</Button>
				</div>

				{/* Secondary Actions - Fun Projects */}
				<div className="mt-4">
					<FunProjectSuggestions />
				</div>
			</TabContent>
		</Tab>
	)
}
