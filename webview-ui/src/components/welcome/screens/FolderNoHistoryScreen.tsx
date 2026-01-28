import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Tab, TabContent } from "../../common/Tab"
import RooHero from "../RooHero"
import { ContextualPrompts } from "../components/ContextualPrompts"

export const FolderNoHistoryScreen = () => {
  const { t } = useAppTranslation()
  
  return (
    <Tab>
      <TabContent className="flex flex-col gap-4 p-6">
        <RooHero />
        <h2 className="text-xl font-semibold mt-0 mb-0">
          {t("welcome:folderNoHistory.heading")}
        </h2>
        
        <p className="text-base text-vscode-descriptionForeground">
          {t("welcome:folderNoHistory.description")}
        </p>
        
        <ContextualPrompts />
      </TabContent>
    </Tab>
  )
}
