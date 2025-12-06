import type { ApiHandler } from "../../api/index"

export interface IntelligentProfileConfig {
	profileId?: string
	profileName?: string
}

export interface IntelligentProviderConfig {
	easyProfile?: IntelligentProfileConfig
	mediumProfile?: IntelligentProfileConfig
	hardProfile?: IntelligentProfileConfig
	classifierProfile?: IntelligentProfileConfig
}

export type DifficultyLevel = "easy" | "medium" | "hard" | "classifier"

// Helper type for profile loading
export type ProfileMap = {
	[K in DifficultyLevel]: ApiHandler | undefined
}
