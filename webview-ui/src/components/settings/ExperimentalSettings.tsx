import React, { HTMLAttributes } from "react"
import { FlaskConical } from "lucide-react"

import type {
	Experiments,
	CodebaseIndexConfig,
	CodebaseIndexModels,
	ProviderSettings,
	ProviderSettingsEntry,
} from "@roo-code/types"

import { EXPERIMENT_IDS, experimentConfigsMap } from "@roo/experiments"

import { ExtensionStateContextType } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"

import { SetCachedStateField, SetExperimentEnabled } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { ExperimentalFeature } from "./ExperimentalFeature"
import { CodeIndexSettings } from "./CodeIndexSettings"
import { AutocompleteSettings } from "./AutocompleteSettings"

type ExperimentalSettingsProps = HTMLAttributes<HTMLDivElement> & {
	experiments: Experiments
	setExperimentEnabled: SetExperimentEnabled
	setCachedStateField: SetCachedStateField<"codebaseIndexConfig">
	// CodeIndexSettings props
	codebaseIndexModels: CodebaseIndexModels | undefined
	codebaseIndexConfig: CodebaseIndexConfig | undefined
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
	areSettingsCommitted: boolean
	// Autocomplete settings props
	autocompleteApiConfigId?: string
	listApiConfigMeta: ProviderSettingsEntry[]
	onAutocompleteApiConfigIdChange: (value: string) => void
}

export const ExperimentalSettings = ({
	experiments,
	setExperimentEnabled,
	setCachedStateField,
	codebaseIndexModels,
	codebaseIndexConfig,
	apiConfiguration,
	setApiConfigurationField,
	areSettingsCommitted,
	autocompleteApiConfigId,
	listApiConfigMeta,
	onAutocompleteApiConfigIdChange,
	className,
	...props
}: ExperimentalSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<FlaskConical className="w-4" />
					<div>{t("settings:sections.experimental")}</div>
				</div>
			</SectionHeader>

			<Section>
				{Object.entries(experimentConfigsMap)
					.filter(([key]) => key in EXPERIMENT_IDS)
					.filter((config) => config[0] !== "MARKETPLACE") // kilocode_change: we have our own market place, filter this out for now
					.map((config) => {
						if (config[0] === "MULTI_FILE_APPLY_DIFF") {
							return (
								<ExperimentalFeature
									key={config[0]}
									experimentKey={config[0]}
									enabled={experiments[EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF] ?? false}
									onChange={(enabled) =>
										setExperimentEnabled(EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF, enabled)
									}
								/>
							)
						}
						return (
							<React.Fragment key={config[0]}>
								<ExperimentalFeature
									experimentKey={config[0]}
									enabled={
										experiments[EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS]] ?? false
									}
									onChange={(enabled) =>
										setExperimentEnabled(
											EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS],
											enabled,
										)
									}
								/>
								{config[0] === "AUTOCOMPLETE" && experiments.autocomplete && (
									<AutocompleteSettings
										autocompleteApiConfigId={autocompleteApiConfigId}
										listApiConfigMeta={listApiConfigMeta}
										onAutocompleteApiConfigIdChange={onAutocompleteApiConfigIdChange}
									/>
								)}
							</React.Fragment>
						)
					})}

				<CodeIndexSettings
					codebaseIndexModels={codebaseIndexModels}
					codebaseIndexConfig={codebaseIndexConfig}
					apiConfiguration={apiConfiguration}
					setCachedStateField={setCachedStateField as SetCachedStateField<keyof ExtensionStateContextType>}
					setApiConfigurationField={setApiConfigurationField}
					areSettingsCommitted={areSettingsCommitted}
				/>
			</Section>
		</div>
	)
}
