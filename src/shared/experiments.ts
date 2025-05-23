import { ExperimentId, ProviderSettings } from "../schemas" // kilocode_change
import { AssertEqual, Equals, Keys, Values } from "../utils/type-fu"

export type { ExperimentId }

export const EXPERIMENT_IDS = {
	AUTOCOMPLETE: "autocomplete",
	AUTO_CONDENSE_CONTEXT: "autoCondenseContext",
	POWER_STEERING: "powerSteering",
} as const satisfies Record<string, ExperimentId>

type _AssertExperimentIds = AssertEqual<Equals<ExperimentId, Values<typeof EXPERIMENT_IDS>>>

type ExperimentKey = Keys<typeof EXPERIMENT_IDS>

interface ExperimentConfig {
	enabled: boolean
	isAvailable: (settings: ProviderSettings) => boolean // kilocode_change
}

export const experimentConfigsMap: Record<ExperimentKey, ExperimentConfig> = {
	// start kilocode_change
	AUTOCOMPLETE: {
		enabled: false,
		isAvailable: (settings) => settings.apiProvider === "kilocode" && !!settings.kilocodeToken,
	},
	AUTO_CONDENSE_CONTEXT: { enabled: false, isAvailable: () => true },
	POWER_STEERING: { enabled: false, isAvailable: () => true },
	// end kilocode_change
}

export const experimentDefault = Object.fromEntries(
	Object.entries(experimentConfigsMap).map(([_, config]) => [
		EXPERIMENT_IDS[_ as keyof typeof EXPERIMENT_IDS] as ExperimentId,
		config.enabled,
	]),
) as Record<ExperimentId, boolean>

export const experiments = {
	get: (id: ExperimentKey): ExperimentConfig | undefined => experimentConfigsMap[id],
	isEnabled: (experimentsConfig: Record<ExperimentId, boolean>, id: ExperimentId) =>
		experimentsConfig[id] ?? experimentDefault[id],
} as const
