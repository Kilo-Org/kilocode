// kilocode_change - new file
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Tab, TabContent } from "../../common/Tab"
import KiloHero from "../KiloHero"
import { ContextualPrompts } from "../components/ContextualPrompts"

export const FolderNoHistoryScreen = () => {
	const { t } = useAppTranslation()

	return (
		<Tab>
			<TabContent className="flex flex-col gap-6 p-8 max-w-2xl mx-auto">
				<KiloHero />

				<div className="text-center space-y-3">
					<h1 className="text-2xl font-bold mt-0 mb-0">{t("welcome:folderNoHistory.heading")}</h1>
					<p className="text-base text-vscode-descriptionForeground leading-relaxed">
						{t("welcome:folderNoHistory.description")}
					</p>
				</div>

				<div className="mt-2">
					<ContextualPrompts />
				</div>
			</TabContent>
		</Tab>
	)
}
