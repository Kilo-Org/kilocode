import { useExtensionState } from "../../../context/ExtensionStateContext"
import { Tab, TabContent } from "../../common/Tab"
import { useAppTranslation } from "../../../i18n/TranslationContext"
import { VSCodeButtonLink } from "../common/VSCodeButtonLink"
import { getKiloCodeBackendAuthUrl } from "../helpers"

const WelcomeView = () => {
	const { uriScheme } = useExtensionState()
	const { t } = useAppTranslation()

	return (
		<Tab>
			<TabContent className="flex flex-col gap-5">
				<h2 className="m-0 p-0">{t("kilocode:welcome.greeting")}</h2>
				<div>{t("kilocode:welcome.introText")}</div>
				<div className="bg-vscode-sideBar-background">
					<div className="flex flex-col gap-1">
						<VSCodeButtonLink href={getKiloCodeBackendAuthUrl(uriScheme)}>
							{t("kilocode:welcome.ctaButton")}
						</VSCodeButtonLink>
					</div>
				</div>
			</TabContent>
		</Tab>
	)
}

export default WelcomeView
