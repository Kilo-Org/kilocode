import React, { HTMLAttributes } from "react"
import { FlaskConical } from "lucide-react"

import type { Experiments } from "@roo-code/types"

import { EXPERIMENT_IDS, experimentConfigsMap } from "@roo/experiments"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"

import {
	SetCachedStateField, // kilocode_change
	SetExperimentEnabled,
} from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { ExperimentalFeature } from "./ExperimentalFeature"
import { FastApplySettings } from "./FastApplySettings" // kilocode_change: Use Fast Apply version
import { ImageGenerationSettings } from "./ImageGenerationSettings"

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
	openRouterImageApiKey?: string
	openRouterImageGenerationSelectedModel?: string
	setOpenRouterImageApiKey?: (apiKey: string) => void
	setImageGenerationSelectedModel?: (model: string) => void
}

export const ExperimentalSettings = ({
	experiments,
	setExperimentEnabled,
	apiConfiguration,
	setApiConfigurationField,
	openRouterImageApiKey,
	openRouterImageGenerationSelectedModel,
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
						// kilocode_change start
						if (config[0] === "MORPH_FAST_APPLY") {
							const enabled =
								experiments[EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS]] ?? false
							return (
								<React.Fragment key={config[0]}>
									<ExperimentalFeature
										key={config[0]}
										experimentKey={config[0]}
										enabled={enabled}
										onChange={(enabled) =>
											setExperimentEnabled(
												EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS],
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
						if (
							config[0] === "IMAGE_GENERATION" &&
							setOpenRouterImageApiKey &&
							setKiloCodeImageApiKey &&
							setImageGenerationSelectedModel
						) {
							return (
								<ImageGenerationSettings
									key={config[0]}
									enabled={experiments[EXPERIMENT_IDS.IMAGE_GENERATION] ?? false}
									onChange={(enabled) =>
										setExperimentEnabled(EXPERIMENT_IDS.IMAGE_GENERATION, enabled)
									}
									openRouterImageApiKey={openRouterImageApiKey}
									kiloCodeImageApiKey={kiloCodeImageApiKey}
									openRouterImageGenerationSelectedModel={openRouterImageGenerationSelectedModel}
									setOpenRouterImageApiKey={setOpenRouterImageApiKey}
									setKiloCodeImageApiKey={setKiloCodeImageApiKey}
									setImageGenerationSelectedModel={setImageGenerationSelectedModel}
									currentProfileKilocodeToken={currentProfileKilocodeToken}
								/>
							)
						}
						return (
							<ExperimentalFeature
								key={config[0]}
								experimentKey={config[0]}
								enabled={experiments[EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS]] ?? false}
								onChange={(enabled) =>
									setExperimentEnabled(
										EXPERIMENT_IDS[config[0] as keyof typeof EXPERIMENT_IDS],
										enabled,
									)
								}
							/>
						)
					})}
			</Section>
		</div>
	)
}
