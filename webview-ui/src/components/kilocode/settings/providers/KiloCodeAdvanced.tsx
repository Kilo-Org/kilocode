import { ExternalLinkIcon } from "@radix-ui/react-icons"
import { type ProviderSettings } from "@roo-code/types"
import type { RouterModels } from "@roo/api"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import {
	useOpenRouterModelProviders,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
} from "@src/components/ui/hooks/useOpenRouterModelProviders"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

type KiloCodeAdvancedProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
}

export const KiloCodeAdvanced = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
}: KiloCodeAdvancedProps) => {
	const { t } = useAppTranslation()
	const { data: openRouterModelProviders } = useOpenRouterModelProviders(
		apiConfiguration?.kilocodeModel,
		undefined,
		undefined,
		{
			enabled:
				!!apiConfiguration?.kilocodeModel &&
				routerModels?.openrouter &&
				Object.keys(routerModels.openrouter).length > 1 &&
				apiConfiguration.kilocodeModel in routerModels.openrouter,
		},
	)

	return (
		<>
			{openRouterModelProviders && Object.keys(openRouterModelProviders).length > 0 && (
				<div>
					<div className="flex items-center gap-1">
						<label className="block font-medium mb-1">
							{t("kilocode:settings.provider.providerRouting.title")}
						</label>
						<a href={`https://openrouter.ai/${apiConfiguration?.kilocodeModel}/providers`}>
							<ExternalLinkIcon className="w-4 h-4" />
						</a>
					</div>
					<Select
						value={apiConfiguration?.openRouterSpecificProvider || OPENROUTER_DEFAULT_PROVIDER_NAME}
						onValueChange={(value) => setApiConfigurationField("openRouterSpecificProvider", value)}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder={t("settings:common.select")} />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={OPENROUTER_DEFAULT_PROVIDER_NAME}>
								{OPENROUTER_DEFAULT_PROVIDER_NAME}
							</SelectItem>
							{Object.entries(openRouterModelProviders).map(([value, { label }]) => (
								<SelectItem key={value} value={value}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<div className="text-sm text-vscode-descriptionForeground mt-1">
						{t("kilocode:settings.provider.providerRouting.description")}
					</div>
				</div>
			)}
		</>
	)
}
