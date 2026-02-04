import { HTMLAttributes } from "react"

import type { Experiments, ImageGenerationProvider } from "@roo-code/types"

import { EXPERIMENT_IDS, experimentConfigsMap } from "@roo/experiments"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"

import {
	SetCachedStateField, // kilocode_change
	SetExperimentEnabled,
} from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { ExperimentalFeature } from "./ExperimentalFeature"
import { FastApplySettings } from "./FastApplySettings" // kilocode_change: Use Fast Apply version
import { ImageGenerationSettings } from "./ImageGenerationSettings"
import { CustomToolsSettings } from "./CustomToolsSettings"
import { STTSettings } from "./STTSettings" // kilocode_change: STT microphone settings

type ExperimentalSettingsProps = HTMLAttributes<HTMLDivElement> & {
	experiments: Experiments
	setExperimentEnabled: SetExperimentEnabled
	// kilocode_change start
	morphApiKey?: string
	fastApplyModel?: string
	fastApplyApiProvider?: string
	setCachedStateField: SetCachedStateField<"morphApiKey" | "fastApplyModel" | "fastApplyApiProvider">
	kiloCodeImageApiKey?: string
	setKiloCodeImageApiKey?: (apiKey: string) => void
	currentProfileKilocodeToken?: string
	// kilocode_change end
	apiConfiguration?: any
	setApiConfigurationField?: any
	imageGenerationProvider?: ImageGenerationProvider
	openRouterImageApiKey?: string
	openRouterImageGenerationSelectedModel?: string
	setImageGenerationProvider?: (provider: ImageGenerationProvider) => void
	setOpenRouterImageApiKey?: (apiKey: string) => void
	setImageGenerationSelectedModel?: (model: string) => void
}

export const ExperimentalSettings = ({
	experiments,
	setExperimentEnabled,
	apiConfiguration,
	setApiConfigurationField,
	imageGenerationProvider,
	openRouterImageApiKey,
	openRouterImageGenerationSelectedModel,
	setImageGenerationProvider,
	setOpenRouterImageApiKey,
	setImageGenerationSelectedModel,
	className,
	// kilocode_change start
	morphApiKey,
	fastApplyModel, // kilocode_change: Fast Apply model selection
	fastApplyApiProvider, // kilocode_change: Fast Apply model api base url
	setCachedStateField,
	setKiloCodeImageApiKey,
	kiloCodeImageApiKey,
	currentProfileKilocodeToken,
	// kilocode_change end
	...props
}: ExperimentalSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>{t("settings:sections.experimental")}</SectionHeader>

			<Section>
				{Object.entries(experimentConfigsMap)
					.filter(([key]) => key in EXPERIMENT_IDS)
					.map((config) => {
						// Use the same translation key pattern as ExperimentalFeature
						const experimentKey = config[0]
						const label = t(`settings:experimental.${experimentKey}.name`)

						if (
							config[0] === "IMAGE_GENERATION" &&
							setImageGenerationProvider &&
							setOpenRouterImageApiKey &&
							setKiloCodeImageApiKey &&
							setImageGenerationSelectedModel
						) {
							return (
								<SearchableSetting
									key={config[0]}
									settingId={`experimental-${config[0].toLowerCase()}`}
									section="experimental"
									label={label}>
									<ImageGenerationSettings
										enabled={experiments[EXPERIMENT_IDS.IMAGE_GENERATION] ?? false}
										onChange={(enabled) =>
											setExperimentEnabled(EXPERIMENT_IDS.IMAGE_GENERATION, enabled)
										}
										imageGenerationProvider={imageGenerationProvider}
										openRouterImageApiKey={openRouterImageApiKey}
										openRouterImageGenerationSelectedModel={openRouterImageGenerationSelectedModel}
										setImageGenerationProvider={setImageGenerationProvider}
										setOpenRouterImageApiKey={setOpenRouterImageApiKey}
										setImageGenerationSelectedModel={setImageGenerationSelectedModel}
									/>
								</SearchableSetting>
							)
						}
						if (config[0] === "CUSTOM_TOOLS") {
							return (
								<SearchableSetting
									key={config[0]}
									settingId={`experimental-${config[0].toLowerCase()}`}
									section="experimental"
									label={label}>
									<CustomToolsSettings
										enabled={experiments[EXPERIMENT_IDS.CUSTOM_TOOLS] ?? false}
										onChange={(enabled) =>
											setExperimentEnabled(EXPERIMENT_IDS.CUSTOM_TOOLS, enabled)
										}
									/>
								</SearchableSetting>
							)
						}
						return (
							<SearchableSetting
								key={config[0]}
								settingId={`experimental-${config[0].toLowerCase()}`}
								section="experimental"
								label={label}>
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
							</SearchableSetting>
						)
					})}
			</Section>
		</div>
	)
}
