import { CreditCard, Key } from "lucide-react"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Button } from "@src/components/ui"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { Tab, TabContent } from "../../common/Tab"

interface PaidModelScreenProps {
	supportsKiloGateway: boolean
}

export const PaidModelScreen = ({ supportsKiloGateway }: PaidModelScreenProps) => {
	const { t } = useAppTranslation()

	const handleCreateAccount = () => {
		vscode.postMessage({
			type: "rooCloudSignIn",
			useProviderSignup: true,
		})
	}

	const handleProviderSettings = () => {
		vscode.postMessage({ type: "openSettings" })
	}

	// Model supports Kilo Gateway subscription
	if (supportsKiloGateway) {
		return (
			<Tab>
				<TabContent className="flex flex-col gap-4 p-6">
					<CreditCard className="size-8" strokeWidth={1.5} />
					<h2 className="text-xl font-semibold mt-0 mb-0">
						{t("welcome:paidModel.withSubscription.heading")}
					</h2>

					<p className="text-base text-vscode-descriptionForeground">
						{t("welcome:paidModel.withSubscription.description")}
					</p>

					<div className="flex flex-col gap-2 mt-2">
						<Button onClick={handleCreateAccount} variant="primary">
							{t("welcome:paidModel.withSubscription.subscribe")}
						</Button>
						<VSCodeLink onClick={handleProviderSettings} className="cursor-pointer text-sm text-center">
							{t("welcome:paidModel.withSubscription.useOwnKey")}
						</VSCodeLink>
					</div>
				</TabContent>
			</Tab>
		)
	}

	// Model doesn't support Kilo Gateway - needs API key
	return (
		<Tab>
			<TabContent className="flex flex-col gap-4 p-6">
				<Key className="size-8" strokeWidth={1.5} />
				<h2 className="text-xl font-semibold mt-0 mb-0">
					{t("welcome:paidModel.withoutSubscription.heading")}
				</h2>

				<p className="text-base text-vscode-descriptionForeground">
					{t("welcome:paidModel.withoutSubscription.description")}
				</p>

				<div className="flex flex-col gap-2 mt-2">
					<Button onClick={handleProviderSettings} variant="primary">
						{t("welcome:paidModel.withoutSubscription.configureProvider")}
					</Button>
					<VSCodeLink onClick={handleCreateAccount} className="cursor-pointer text-sm text-center">
						{t("welcome:paidModel.withoutSubscription.orCreateAccount")}
					</VSCodeLink>
				</div>
			</TabContent>
		</Tab>
	)
}
