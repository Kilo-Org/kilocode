import { useCallback, useEffect, useMemo, useState } from "react"
import { type ProviderSettings, type ProviderSettingsEntry } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { VirtualQuotaFallbackProviderPresentation } from "./VirtualQuotaFallbackProviderPresentation"
import { UsageResultByDuration } from "@roo-code/types"

type VirtualQuotaFallbackProviderProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export type VirtualQuotaFallbackProviderData = {
	profileName?: string
	profileId?: string
	profileLimits?: {
		tokensPerMinute?: number
		tokensPerHour?: number
		tokensPerDay?: number
		requestsPerMinute?: number
		requestsPerHour?: number
		requestsPerDay?: number
	}
}

export const VirtualQuotaFallbackProvider = ({
	apiConfiguration,
	setApiConfigurationField,
}: VirtualQuotaFallbackProviderProps) => {
	const { listApiConfigMeta, currentApiConfigName } = useExtensionState()
	const [isAlertOpen, setIsAlertOpen] = useState(false)
	const [usageData, setUsageData] = useState<Record<string, UsageResultByDuration>>({})

	// Get current profile ID to exclude from available profiles
	const currentProfile = listApiConfigMeta?.find((config) => config.name === currentApiConfigName)
	const currentProfileId = currentProfile?.id

	// Filter out virtual profile profiles and current profile
	const availableProfiles = useMemo(() => {
		return (
			listApiConfigMeta?.filter((profile: ProviderSettingsEntry) => {
				return profile.apiProvider !== "virtual-quota-fallback" && profile.id !== currentProfileId
			}) || []
		)
	}, [listApiConfigMeta, currentProfileId])

	const profiles = useMemo(() => {
		return apiConfiguration.profiles && apiConfiguration.profiles.length > 0 ? apiConfiguration.profiles : [{}]
	}, [apiConfiguration.profiles])

	const updateProfiles = useCallback(
		(newProfiles: VirtualQuotaFallbackProviderData[]) => {
			setApiConfigurationField("profiles", newProfiles)
		},
		[setApiConfigurationField],
	)

	const handleProfileChange = useCallback(
		(index: number, profile: VirtualQuotaFallbackProviderData) => {
			const newProfiles = [...profiles]
			newProfiles[index] = profile
			updateProfiles(newProfiles)
		},
		[profiles, updateProfiles],
	)

	const handleProfileSelect = useCallback(
		(index: number, selectedId: string) => {
			const selectedProfile = availableProfiles.find((profile) => profile.id === selectedId)
			if (selectedProfile) {
				const updatedProfile = {
					...profiles[index],
					profileId: selectedProfile.id,
					profileName: selectedProfile.name,
				}
				handleProfileChange(index, updatedProfile)
			}
		},
		[availableProfiles, profiles, handleProfileChange],
	)

	const addProfile = useCallback(() => {
		const newProfiles = [...profiles, {}]
		updateProfiles(newProfiles)
	}, [profiles, updateProfiles])

	const removeProfile = useCallback(
		(index: number) => {
			if (profiles.length > 1) {
				const newProfiles = profiles.filter((_, i) => i !== index)
				updateProfiles(newProfiles)
			}
		},
		[profiles, updateProfiles],
	)

	const swapProfiles = useCallback(
		(fromIndex: number, toIndex: number) => {
			const newProfiles = [...profiles]
			const temp = newProfiles[fromIndex]
			newProfiles[fromIndex] = newProfiles[toIndex]
			newProfiles[toIndex] = temp
			updateProfiles(newProfiles)
		},
		[profiles, updateProfiles],
	)

	const moveProfileUp = useCallback(
		(index: number) => {
			if (index > 0) {
				swapProfiles(index, index - 1)
			}
		},
		[swapProfiles],
	)

	const moveProfileDown = useCallback(
		(index: number) => {
			if (index < profiles.length - 1) {
				swapProfiles(index, index + 1)
			}
		},
		[profiles.length, swapProfiles],
	)

	const handleClearUsageData = useCallback(() => {
		vscode.postMessage({ type: "clearUsageData" })
		setIsAlertOpen(false)
	}, [])

	const getUsedProfileIds = useCallback(
		(excludeIndex: number) => {
			return profiles
				.map((p, i) => (i !== excludeIndex ? p.profileId : null))
				.filter((id): id is string => Boolean(id))
		},
		[profiles],
	)

	// Handle usage data fetching
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "usageDataResponse" && message.text) {
				setUsageData((prev) => ({
					...prev,
					[message.text]: message.values,
				}))
			}
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	// Fetch usage data for all profiles
	useEffect(() => {
		profiles.forEach((profile) => {
			if (profile.profileId) {
				vscode.postMessage({ type: "getUsageData", text: profile.profileId })
			}
		})
	}, [profiles])

	return (
		<VirtualQuotaFallbackProviderPresentation
			profiles={profiles}
			availableProfiles={availableProfiles}
			isAlertOpen={isAlertOpen}
			usageData={usageData}
			onProfileChange={handleProfileChange}
			onProfileSelect={handleProfileSelect}
			onAddProfile={addProfile}
			onRemoveProfile={removeProfile}
			onMoveProfileUp={moveProfileUp}
			onMoveProfileDown={moveProfileDown}
			onClearUsageData={handleClearUsageData}
			onSetIsAlertOpen={setIsAlertOpen}
			getUsedProfileIds={getUsedProfileIds}
		/>
	)
}
