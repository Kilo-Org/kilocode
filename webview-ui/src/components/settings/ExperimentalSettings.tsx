import React, { HTMLAttributes } from "react"

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
					.filter((config) => config[0] !== "MARKETPLACE") // kilocode_change: we have our own market place, filter this out for now
					// Hide MULTIPLE_NATIVE_TOOL_CALLS - feature is on hold
					.filter(([key]) => key !== "MULTIPLE_NATIVE_TOOL_CALLS")
					// Hide WORKFLOW_DISCOVERY - use AUTO_EXECUTE_WORKFLOW instead // kilocode_change
					.filter(([key]) => key !== "WORKFLOW_DISCOVERY") // kilocode_change
					.map((config) => {
						const experimentKey = config[0]
						const label = t(`settings:experimental.${experimentKey.toLowerCase()}.name`)
						// kilocode_change start: Special handling for experiments with custom components
						if (experimentKey === "MULTI_FILE_APPLY_DIFF") {
							return (
								<SearchableSetting
									key={experimentKey}
									settingId={`experimental-${experimentKey.toLowerCase()}`}
									section="experimental"
									label={label}>
									<ExperimentalFeature
										experimentKey={experimentKey}
										enabled={experiments[EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF] ?? false}
										onChange={(enabled) =>
											setExperimentEnabled(EXPERIMENT_IDS.MULTI_FILE_APPLY_DIFF, enabled)
										}
									/>
								</SearchableSetting>
							)
						}
						if (experimentKey === "MORPH_FAST_APPLY") {
							const enabled =
								experiments[EXPERIMENT_IDS[experimentKey as keyof typeof EXPERIMENT_IDS]] ?? false
							return (
								<React.Fragment key={experimentKey}>
									<ExperimentalFeature
										experimentKey={experimentKey}
										enabled={enabled}
										onChange={(enabled) =>
											setExperimentEnabled(
												EXPERIMENT_IDS[experimentKey as keyof typeof EXPERIMENT_IDS],
												enabled,
											)
										}
									/>
									{enabled && (
										<FastApplySettings
											setCachedStateField={setCachedStateField}
											morphApiKey={morphApiKey}
											fastApplyModel={fastApplyModel}
											fastApplyApiProvider={fastApplyApiProvider}
										/>
									)}
								</React.Fragment>
							)
						}
						// kilocode_change end
						if (experimentKey === "SPEECH_TO_TEXT") {
							const enabled = experiments[EXPERIMENT_IDS.SPEECH_TO_TEXT] ?? false
							return (
								<React.Fragment key={experimentKey}>
									<ExperimentalFeature
										experimentKey={experimentKey}
										enabled={enabled}
										onChange={(enabled) =>
											setExperimentEnabled(EXPERIMENT_IDS.SPEECH_TO_TEXT, enabled)
										}
									/>
									{enabled && <STTSettings />}
								</React.Fragment>
							)
						}
						if (
							experimentKey === "IMAGE_GENERATION" &&
							setImageGenerationProvider &&
							setOpenRouterImageApiKey &&
							setKiloCodeImageApiKey &&
							setImageGenerationSelectedModel
						) {
							return (
								<SearchableSetting
									key={experimentKey}
									settingId={`experimental-${experimentKey.toLowerCase()}`}
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
										kiloCodeImageApiKey={kiloCodeImageApiKey}
										setKiloCodeImageApiKey={setKiloCodeImageApiKey}
										currentProfileKilocodeToken={currentProfileKilocodeToken}
									/>
								</SearchableSetting>
							)
						}
						if (experimentKey === "CUSTOM_TOOLS") {
							return (
								<SearchableSetting
									key={experimentKey}
									settingId={`experimental-${experimentKey.toLowerCase()}`}
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
						// kilocode_change start: Skip experiments that have special handling above
						// to prevent duplicates in the UI when conditions aren't met
						if (
							experimentKey === "MULTI_FILE_APPLY_DIFF" ||
							experimentKey === "MORPH_FAST_APPLY" ||
							experimentKey === "IMAGE_GENERATION" ||
							experimentKey === "SPEECH_TO_TEXT" ||
							experimentKey === "CUSTOM_TOOLS"
						) {
							return null
						}
						// kilocode_change end
						return (
							<SearchableSetting
								key={experimentKey}
								settingId={`experimental-${experimentKey.toLowerCase()}`}
								section="experimental"
								label={label}>
								<ExperimentalFeature
									experimentKey={experimentKey}
									enabled={
										experiments[EXPERIMENT_IDS[experimentKey as keyof typeof EXPERIMENT_IDS]] ?? false
									}
									onChange={(enabled) =>
										setExperimentEnabled(
											EXPERIMENT_IDS[experimentKey as keyof typeof EXPERIMENT_IDS],
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
