import { useCallback, useEffect, useMemo, useState } from "react"
import { type ProviderSettings, type ProviderSettingsEntry } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { IntelligentProviderPresentation } from "./IntelligentProviderPresentation"

type IntelligentProviderProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	onValidationChange?: (isValid: boolean, errorMessage?: string) => void
}

export type IntelligentProfileData = {
	profileName?: string
	profileId?: string
}

export interface IntelligentProviderConfig {
	easyProfile?: IntelligentProfileData
	mediumProfile?: IntelligentProfileData
	hardProfile?: IntelligentProfileData
	classifierProfile?: IntelligentProfileData
}

export const IntelligentProvider = ({
	apiConfiguration,
	setApiConfigurationField,
	onValidationChange,
}: IntelligentProviderProps) => {
	const { listApiConfigMeta, currentApiConfigName } = useExtensionState()
	const [isAlertOpen, setIsAlertOpen] = useState(false)

	// Show validation error in component UI for better user experience
	const validationError = useMemo(() => {
		const profiles = apiConfiguration.profiles || []
		const difficultyLevels = profiles.map((p: any) => p.difficultyLevel)
		const hasEasy = difficultyLevels.includes("easy")
		const hasMedium = difficultyLevels.includes("medium")
		const hasHard = difficultyLevels.includes("hard")

		if (!hasEasy || !hasMedium || !hasHard) {
			const missing = []
			if (!hasEasy) missing.push("Easy")
			if (!hasMedium) missing.push("Medium")
			if (!hasHard) missing.push("Hard")
			return `Required profiles missing: ${missing.join(", ")}. Please configure all three difficulty profiles before saving.`
		}
		return null
	}, [apiConfiguration.profiles])

	// Notify parent component about validation state
	const isValid = !validationError
	useEffect(() => {
		onValidationChange?.(isValid, validationError || undefined)
	}, [isValid, validationError, onValidationChange])

	// Get current profile ID to exclude from available profiles
	const currentProfile = listApiConfigMeta?.find((config) => config.name === currentApiConfigName)
	const currentProfileId = currentProfile?.id

	// Filter out current profile (but allow virtual-quota-fallback profiles)
	const availableProfiles = useMemo(() => {
		return (
			listApiConfigMeta?.filter((profile: ProviderSettingsEntry) => {
				return profile.id !== currentProfileId
			}) || []
		)
	}, [listApiConfigMeta, currentProfileId])

	// Access intelligent config from the generic provider settings
	// Using the profiles field from the intelligent schema
	const intelligentConfig = useMemo(() => {
		// Map the profiles array to our config structure
		const profiles = apiConfiguration.profiles || []
		const config: IntelligentProviderConfig = {}

		profiles.forEach((profile: any) => {
			if (profile.difficultyLevel === "easy") {
				config.easyProfile = {
					profileId: profile.profileId,
					profileName: profile.profileName,
				}
			} else if (profile.difficultyLevel === "medium") {
				config.mediumProfile = {
					profileId: profile.profileId,
					profileName: profile.profileName,
				}
			} else if (profile.difficultyLevel === "hard") {
				config.hardProfile = {
					profileId: profile.profileId,
					profileName: profile.profileName,
				}
			} else if (profile.difficultyLevel === "classifier") {
				config.classifierProfile = {
					profileId: profile.profileId,
					profileName: profile.profileName,
				}
			}
		})

		return config
	}, [apiConfiguration])

	const updateIntelligentConfig = useCallback(
		(newConfig: IntelligentProviderConfig) => {
			// Convert our config structure back to the profiles array format
			const profiles: any[] = []

			if (newConfig.easyProfile) {
				profiles.push({
					profileName: newConfig.easyProfile.profileName,
					profileId: newConfig.easyProfile.profileId,
					difficultyLevel: "easy",
				})
			}

			if (newConfig.mediumProfile) {
				profiles.push({
					profileName: newConfig.mediumProfile.profileName,
					profileId: newConfig.mediumProfile.profileId,
					difficultyLevel: "medium",
				})
			}

			if (newConfig.hardProfile) {
				profiles.push({
					profileName: newConfig.hardProfile.profileName,
					profileId: newConfig.hardProfile.profileId,
					difficultyLevel: "hard",
				})
			}

			if (newConfig.classifierProfile) {
				profiles.push({
					profileName: newConfig.classifierProfile.profileName,
					profileId: newConfig.classifierProfile.profileId,
					difficultyLevel: "classifier",
				})
			}

			setApiConfigurationField("profiles" as keyof ProviderSettings, profiles)
		},
		[setApiConfigurationField],
	)

	const handleProfileChange = useCallback(
		(
			profileType: "easyProfile" | "mediumProfile" | "hardProfile" | "classifierProfile",
			profile: IntelligentProfileData,
		) => {
			const newConfig = {
				...intelligentConfig,
				[profileType]: profile,
			}
			updateIntelligentConfig(newConfig)
		},
		[intelligentConfig, updateIntelligentConfig],
	)

	const handleProfileSelect = useCallback(
		(profileType: "easyProfile" | "mediumProfile" | "hardProfile" | "classifierProfile", selectedId: string) => {
			const selectedProfile = availableProfiles.find((profile) => profile.id === selectedId)
			if (selectedProfile) {
				const updatedProfile = {
					profileId: selectedProfile.id,
					profileName: selectedProfile.name,
				}
				handleProfileChange(profileType, updatedProfile)
			}
		},
		[availableProfiles, handleProfileChange],
	)

	const handleClearUsageData = useCallback(() => {
		vscode.postMessage({ type: "clearUsageData" })
		setIsAlertOpen(false)
	}, [])

	return (
		<>
			{validationError && (
				<div className="text-sm text-vscode-errorForeground bg-vscode-inputValidation-errorBackground border border-vscode-inputValidation-errorBorder rounded-md p-3 mb-4">
					{validationError}
				</div>
			)}
			<IntelligentProviderPresentation
				config={intelligentConfig}
				availableProfiles={availableProfiles}
				isAlertOpen={isAlertOpen}
				onProfileChange={handleProfileChange}
				onProfileSelect={handleProfileSelect}
				onClearUsageData={handleClearUsageData}
				onSetIsAlertOpen={setIsAlertOpen}
			/>
		</>
	)
}
