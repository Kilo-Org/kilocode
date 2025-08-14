import {
	type ProviderSettings,
	openRouterProviderSortSchema,
	openRouterProviderDataCollectionSchema,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from "@src/components/ui"
import { z } from "zod"
import { safeJsonParse } from "@roo/safeJsonParse"
import { useModelProviders } from "@/components/ui/hooks/useSelectedModel"
import { cn } from "@/lib/utils"

type ProviderPreference =
	| {
			type: "default" | z.infer<typeof openRouterProviderSortSchema>
	  }
	| {
			type: "specific"
			provider: string
	  }

const ProviderSelectItem = ({ value, children }: { value: ProviderPreference; children: React.ReactNode }) => {
	return <SelectItem value={JSON.stringify(value)}>{children}</SelectItem>
}

const getProviderPreference = (apiConfiguration: ProviderSettings): ProviderPreference =>
	apiConfiguration.openRouterSpecificProvider &&
	apiConfiguration.openRouterSpecificProvider !== OPENROUTER_DEFAULT_PROVIDER_NAME
		? { type: "specific", provider: apiConfiguration.openRouterSpecificProvider }
		: { type: apiConfiguration.openRouterProviderSort ?? "default" }

interface Props {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
}

export const KiloProviderRouting = ({ apiConfiguration, setApiConfigurationField }: Props) => {
	const { t } = useAppTranslation()
	const providers = Object.values(useModelProviders(apiConfiguration).data ?? {})

	const onValueChange = (value: string) => {
		const preference = safeJsonParse<ProviderPreference>(value)
		setApiConfigurationField(
			"openRouterProviderSort",
			openRouterProviderSortSchema.safeParse(preference?.type).data,
		)
		setApiConfigurationField(
			"openRouterSpecificProvider",
			preference?.type === "specific" ? preference.provider : OPENROUTER_DEFAULT_PROVIDER_NAME,
		)
	}

	const specficProvider = apiConfiguration.openRouterSpecificProvider
	const specificProviderIsSet = !!specficProvider && specficProvider !== OPENROUTER_DEFAULT_PROVIDER_NAME
	const specificProviderIsInvalid = specificProviderIsSet && !providers.find((p) => p.label === specficProvider)

	return (
		<div className="flex flex-col gap-1">
			<div className="flex justify-between items-center">
				<label className="block font-medium mb-1">Provider Routing</label>
			</div>
			<Select value={JSON.stringify(getProviderPreference(apiConfiguration))} onValueChange={onValueChange}>
				<SelectTrigger className={cn("w-full", specificProviderIsInvalid && "border-destructive border-3")}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<ProviderSelectItem value={{ type: "default" }}>
						{t("kilocode:settings.provider.providerRouting.sorting.default")}
					</ProviderSelectItem>
					<ProviderSelectItem value={{ type: openRouterProviderSortSchema.Values.price }}>
						{t("kilocode:settings.provider.providerRouting.sorting.price")}
					</ProviderSelectItem>
					<ProviderSelectItem value={{ type: openRouterProviderSortSchema.Values.throughput }}>
						{t("kilocode:settings.provider.providerRouting.sorting.throughput")}
					</ProviderSelectItem>
					<ProviderSelectItem value={{ type: openRouterProviderSortSchema.Values.latency }}>
						{t("kilocode:settings.provider.providerRouting.sorting.latency")}
					</ProviderSelectItem>
					<SelectSeparator />
					{specificProviderIsInvalid && (
						<ProviderSelectItem value={{ type: "specific", provider: specficProvider }}>
							{specficProvider}
						</ProviderSelectItem>
					)}
					{providers.map((provider) => (
						<ProviderSelectItem
							key={`specific:${provider.label}`}
							value={{ type: "specific", provider: provider.label }}>
							{provider.label}
						</ProviderSelectItem>
					))}
				</SelectContent>
			</Select>
			<Select
				value={
					specificProviderIsSet ? "default" : (apiConfiguration.openRouterProviderDataCollection ?? "default")
				}
				onValueChange={(value) => {
					if (specificProviderIsSet) {
						return
					}
					setApiConfigurationField(
						"openRouterProviderDataCollection",
						openRouterProviderDataCollectionSchema.safeParse(value).data,
					)
				}}>
				<SelectTrigger disabled={specificProviderIsSet} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="default">
						{t("kilocode:settings.provider.providerRouting.dataCollection.default")}
					</SelectItem>
					<SelectItem value={openRouterProviderDataCollectionSchema.Values.allow}>
						{t("kilocode:settings.provider.providerRouting.dataCollection.allow")}
					</SelectItem>
					<SelectItem value={openRouterProviderDataCollectionSchema.Values.deny}>
						{t("kilocode:settings.provider.providerRouting.dataCollection.deny")}
					</SelectItem>
				</SelectContent>
			</Select>
		</div>
	)
}
