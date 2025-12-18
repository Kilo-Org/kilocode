import {
	type ProviderSettings,
	openRouterProviderSortSchema,
	openRouterProviderDataCollectionSchema,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
	getAppUrl,
	TelemetryEventName,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from "@src/components/ui"
import { z } from "zod"
import { safeJsonParse } from "@roo/safeJsonParse"
import { useModelProviders } from "@/components/ui/hooks/useSelectedModel"
import { cn } from "@/lib/utils"
import { VSCodeButtonLink } from "@/components/common/VSCodeButtonLink"
import { telemetryClient } from "@/utils/TelemetryClient"

const DEFAULT_VALUE_KEY = "default" as const
const SPECIFIC_PROVIDER_KEY = "specific" as const
const ZERO_DATA_RETENTION_KEY = "zdr" as const

type ProviderPreference =
	| {
			type: typeof DEFAULT_VALUE_KEY | z.infer<typeof openRouterProviderSortSchema>
	  }
	| {
			type: typeof SPECIFIC_PROVIDER_KEY
			provider: string
	  }

const ProviderSelectItem = ({ value, children }: { value: ProviderPreference; children: React.ReactNode }) => {
	return <SelectItem value={JSON.stringify(value)}>{children}</SelectItem>
}

const getProviderPreference = (apiConfiguration: ProviderSettings): ProviderPreference =>
	apiConfiguration.openRouterSpecificProvider &&
	apiConfiguration.openRouterSpecificProvider !== OPENROUTER_DEFAULT_PROVIDER_NAME
		? { type: SPECIFIC_PROVIDER_KEY, provider: apiConfiguration.openRouterSpecificProvider }
		: { type: apiConfiguration.openRouterProviderSort ?? DEFAULT_VALUE_KEY }

interface Props {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
	kilocodeDefaultModel: string
}

export const KiloProviderRoutingManagedByOrganization = (props: { organizationId: string }) => {
	const { t } = useAppTranslation()
	return (
		<div className="flex flex-col gap-1">
			<div className="flex justify-between items-center">
				<label className="block font-medium mb-1">
					{t("kilocode:settings.provider.providerRouting.title")}
				</label>
			</div>
			<div className="text-sm text-vscode-descriptionForeground">
				<VSCodeButtonLink
					href={getAppUrl(`/organizations/${props.organizationId}`)}
					appearance="secondary"
					className="text-sm w-full whitespace-normal h-auto py-3">
					{t("kilocode:settings.provider.providerRouting.managedByOrganization")}
				</VSCodeButtonLink>
			</div>
		</div>
	)
}

export const KiloProviderRouting = ({ apiConfiguration, setApiConfigurationField, kilocodeDefaultModel }: Props) => {
	const { t } = useAppTranslation()
	const providers = Object.values(useModelProviders(kilocodeDefaultModel, apiConfiguration).data ?? {})

	const onValueChange = (value: string) => {
		const preference = safeJsonParse<ProviderPreference>(value)
		setApiConfigurationField(
			"openRouterProviderSort",
			openRouterProviderSortSchema.safeParse(preference?.type).data,
		)
		setApiConfigurationField(
			"openRouterSpecificProvider",
			preference?.type === SPECIFIC_PROVIDER_KEY ? preference.provider : OPENROUTER_DEFAULT_PROVIDER_NAME,
		)
	}

	const specficProvider = apiConfiguration.openRouterSpecificProvider
	const specificProviderIsInvalid =
		!!specficProvider &&
		specficProvider !== OPENROUTER_DEFAULT_PROVIDER_NAME &&
		!providers.find((p) => p.label === specficProvider)

	return (
		<div className="flex flex-col gap-1">
			<div className="flex justify-between items-center">
				<label className="block font-medium mb-1">
					{t("kilocode:settings.provider.providerRouting.title")}
				</label>
			</div>
			<Select value={JSON.stringify(getProviderPreference(apiConfiguration))} onValueChange={onValueChange}>
				<SelectTrigger className={cn("w-full", specificProviderIsInvalid && "border-destructive border-3")}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<ProviderSelectItem value={{ type: DEFAULT_VALUE_KEY }}>
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
						<ProviderSelectItem value={{ type: SPECIFIC_PROVIDER_KEY, provider: specficProvider }}>
							{specficProvider}
						</ProviderSelectItem>
					)}
					{providers.map((provider) => (
						<ProviderSelectItem
							key={`${SPECIFIC_PROVIDER_KEY}:${provider.label}`}
							value={{ type: SPECIFIC_PROVIDER_KEY, provider: provider.label }}>
							{provider.label}
						</ProviderSelectItem>
					))}
				</SelectContent>
			</Select>
			<Select
				value={
					apiConfiguration.openRouterZdr
						? ZERO_DATA_RETENTION_KEY
						: (apiConfiguration.openRouterProviderDataCollection ?? DEFAULT_VALUE_KEY)
				}
				onValueChange={(value) => {
					setApiConfigurationField(
						"openRouterProviderDataCollection",
						openRouterProviderDataCollectionSchema.safeParse(value).data,
					)
					setApiConfigurationField("openRouterZdr", value === ZERO_DATA_RETENTION_KEY || undefined)
				}}>
				<SelectTrigger className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={DEFAULT_VALUE_KEY}>
						{apiConfiguration.apiProvider === "kilocode"
							? t("kilocode:settings.provider.providerRouting.dataCollection.allowFree")
							: t("kilocode:settings.provider.providerRouting.dataCollection.default")}
					</SelectItem>
					<SelectItem value={openRouterProviderDataCollectionSchema.Values.allow}>
						{t("kilocode:settings.provider.providerRouting.dataCollection.allow")}
					</SelectItem>
					<SelectItem value={openRouterProviderDataCollectionSchema.Values.deny}>
						{t("kilocode:settings.provider.providerRouting.dataCollection.deny")}
					</SelectItem>
					<SelectItem value={ZERO_DATA_RETENTION_KEY}>
						{t("kilocode:settings.provider.providerRouting.dataCollection.zdr")}
					</SelectItem>
				</SelectContent>
			</Select>
			{apiConfiguration.apiProvider === "kilocode" && (
				<VSCodeButtonLink
					onClick={() => {
						telemetryClient.capture(TelemetryEventName.CREATE_ORGANIZATION_LINK_CLICKED, {
							origin: "provider-routing",
						})
					}}
					href={getAppUrl("/organizations/new")}
					appearance="primary"
					className="text-sm w-full whitespace-normal h-auto py-3">
					{t("kilocode:settings.provider.providerRouting.createOrganization")}
				</VSCodeButtonLink>
			)}
		</div>
	)
}
