import { useCallback, useMemo, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { PlusIcon, TrashIcon } from "@radix-ui/react-icons"
import { ChevronUp, ChevronDown } from "lucide-react"

import { type ProviderSettings, type ProviderSettingsEntry } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@src/components/ui/alert-dialog"
import { inputEventTransform } from "../transforms"

type VirtualQuotaFallbackProviderProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

type VirtualQuotaFallbackProviderData = {
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

type LimitInputsProps = {
	profile: VirtualQuotaFallbackProviderData
	index: number
	onProfileChange: (index: number, profile: VirtualQuotaFallbackProviderData) => void
}

export const VirtualQuotaFallbackProvider = ({
	apiConfiguration,
	setApiConfigurationField,
}: VirtualQuotaFallbackProviderProps) => {
	const { listApiConfigMeta, currentApiConfigName } = useExtensionState()
	const [isAlertOpen, setIsAlertOpen] = useState(false)
	const { t } = useTranslation()

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

	return (
		<>
			<h3 className="text-lg font-medium mb-0">
				<Trans i18nKey="kilocode:virtualProvider.title">Virtual Quota Fallback Settings</Trans>
			</h3>
			<div className="text-sm text-vscode-descriptionForeground mb-4">
				<Trans i18nKey="kilocode:virtualProvider.description">
					Configure a list of profiles each with their own limits. When one profiles limits are reached, the
					next profile in the list will be used until none remain.
				</Trans>
			</div>

			<div className="space-y-1">
				{profiles.map((profile, index) => {
					const usedProfileIds = getUsedProfileIds(index)
					const availableForThisSlot = availableProfiles.filter(
						(profile) => !usedProfileIds.includes(profile.id),
					)

					return (
						<div key={index} className="border border-vscode-settings-sashBorder rounded-md p-2">
							<div className="flex items-center justify-between mb-3">
								<label className="block font-medium">
									{index === 0
										? t("kilocode:virtualProvider.primaryProfileLabel", { number: index + 1 })
										: t("kilocode:virtualProvider.profileLabel", { number: index + 1 })}
								</label>
								<div className="flex items-center gap-1">
									{/* Move Up Button */}
									<VSCodeButton
										appearance="icon"
										onClick={() => moveProfileUp(index)}
										disabled={index === 0}
										title={t("kilocode:virtualProvider.moveProfileUp")}>
										<ChevronUp size={16} />
									</VSCodeButton>
									{/* Move Down Button */}
									<VSCodeButton
										appearance="icon"
										onClick={() => moveProfileDown(index)}
										disabled={index === profiles.length - 1}
										title={t("kilocode:virtualProvider.moveProfileDown")}>
										<ChevronDown size={16} />
									</VSCodeButton>
									{/* Remove Button */}
									{profiles.length > 1 && (
										<VSCodeButton
											appearance="icon"
											onClick={() => removeProfile(index)}
											title={t("kilocode:virtualProvider.removeProfile")}>
											<TrashIcon />
										</VSCodeButton>
									)}
								</div>
							</div>

							<Select
								value={profile.profileId || ""}
								onValueChange={(value) => handleProfileSelect(index, value)}
								disabled={availableForThisSlot.length === 0}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder={t("kilocode:virtualProvider.selectProfilePlaceholder")} />
								</SelectTrigger>
								<SelectContent>
									{availableForThisSlot.map((profile) => (
										<SelectItem key={profile.id} value={profile.id}>
											{profile.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>

							<VirtualLimitInputs profile={profile} index={index} onProfileChange={handleProfileChange} />
						</div>
					)
				})}

				<div className="flex justify-center p-4">
					<VSCodeButton
						appearance="secondary"
						onClick={addProfile}
						disabled={availableProfiles.length <= profiles.length}>
						<PlusIcon className="mr-2" />
						<Trans i18nKey="kilocode:virtualProvider.addProfile">Add Profile</Trans>
					</VSCodeButton>
				</div>

				{availableProfiles.length === 0 ? (
					<div className="text-sm text-vscode-descriptionForeground text-center p-4 border border-vscode-settings-sashBorder rounded-md">
						<Trans i18nKey="kilocode:virtualProvider.noProfilesAvailable">
							No profile profiles available. Please configure at least one non-virtual profile profile
							first.
						</Trans>
					</div>
				) : null}
			</div>

			<div className="p-4 border border-vscode-editorWarning-foreground rounded-md">
				<div className="text-md font-semibold text-vscode-editorWarning-foreground">
					<Trans i18nKey="kilocode:virtualProvider.dangerZoneTitle">Danger Zone</Trans>
				</div>
				<p className="text-sm text-vscode-descriptionForeground mt-1 mb-3">
					<Trans i18nKey="kilocode:virtualProvider.dangerZoneDescription">
						These actions are destructive and cannot be undone.
					</Trans>
				</p>
				<VSCodeButton appearance="secondary" onClick={() => setIsAlertOpen(true)}>
					<Trans i18nKey="kilocode:virtualProvider.clearUsageData">Clear Usage Data</Trans>
				</VSCodeButton>
			</div>

			<AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans i18nKey="kilocode:virtualProvider.confirmClearTitle">Are you sure?</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>
							<Trans i18nKey="kilocode:virtualProvider.confirmClearDescription">
								This will permanently delete all stored usage data for virtual profiles. This action
								cannot be undone.
							</Trans>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							<Trans i18nKey="common:cancel">Cancel</Trans>
						</AlertDialogCancel>
						<AlertDialogAction onClick={handleClearUsageData}>
							<Trans i18nKey="common:confirm">Confirm</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}

const VirtualLimitInputs = ({ profile, index, onProfileChange }: LimitInputsProps) => {
	const handleLimitChange = useCallback(
		(limitKey: keyof NonNullable<VirtualQuotaFallbackProviderData["profileLimits"]>) => (event: unknown) => {
			const value = inputEventTransform(event)
			const updatedProfile = {
				...profile,
				profileLimits: {
					...profile.profileLimits,
					[limitKey]: value === "" ? undefined : Number(value),
				},
			}
			onProfileChange(index, updatedProfile)
		},
		[profile, index, onProfileChange],
	)

	if (!profile.profileId) {
		return null
	}

	return (
		<div className="space-y-4 p-2 rounded-md mt-2">
			{/* Tokens Row */}
			<div>
				<label className="block text-sm font-medium mb-2">
					<Trans i18nKey="kilocode:virtualProvider.tokensLabel">Tokens</Trans>
				</label>
				<div className="grid grid-cols-3 gap-x-4">
					<div>
						<label className="block text-xs text-vscode-descriptionForeground mb-1">
							<Trans i18nKey="kilocode:virtualProvider.perMinute">Per Minute</Trans>
						</label>
						<VSCodeTextField
							value={profile.profileLimits?.tokensPerMinute?.toString() ?? ""}
							onInput={handleLimitChange("tokensPerMinute")}
							className="w-full"
						/>
					</div>
					<div>
						<label className="block text-xs text-vscode-descriptionForeground mb-1">
							<Trans i18nKey="kilocode:virtualProvider.perHour">Per Hour</Trans>
						</label>
						<VSCodeTextField
							value={profile.profileLimits?.tokensPerHour?.toString() ?? ""}
							onInput={handleLimitChange("tokensPerHour")}
							className="w-full"
						/>
					</div>
					<div>
						<label className="block text-xs text-vscode-descriptionForeground mb-1">
							<Trans i18nKey="kilocode:virtualProvider.perDay">Per Day</Trans>
						</label>
						<VSCodeTextField
							value={profile.profileLimits?.tokensPerDay?.toString() ?? ""}
							onInput={handleLimitChange("tokensPerDay")}
							className="w-full"
						/>
					</div>
				</div>
			</div>

			{/* Requests Row */}
			<div>
				<label className="block text-sm font-medium mb-2">
					<Trans i18nKey="kilocode:virtualProvider.requestsLabel">Requests</Trans>
				</label>
				<div className="grid grid-cols-3 gap-x-4">
					<div>
						<label className="block text-xs text-vscode-descriptionForeground mb-1">
							<Trans i18nKey="kilocode:virtualProvider.perMinute">Per Minute</Trans>
						</label>
						<VSCodeTextField
							value={profile.profileLimits?.requestsPerMinute?.toString() ?? ""}
							onInput={handleLimitChange("requestsPerMinute")}
							className="w-full"
						/>
					</div>
					<div>
						<label className="block text-xs text-vscode-descriptionForeground mb-1">
							<Trans i18nKey="kilocode:virtualProvider.perHour">Per Hour</Trans>
						</label>
						<VSCodeTextField
							value={profile.profileLimits?.requestsPerHour?.toString() ?? ""}
							onInput={handleLimitChange("requestsPerHour")}
							className="w-full"
						/>
					</div>
					<div>
						<label className="block text-xs text-vscode-descriptionForeground mb-1">
							<Trans i18nKey="kilocode:virtualProvider.perDay">Per Day</Trans>
						</label>
						<VSCodeTextField
							value={profile.profileLimits?.requestsPerDay?.toString() ?? ""}
							onInput={handleLimitChange("requestsPerDay")}
							className="w-full"
						/>
					</div>
				</div>
			</div>
		</div>
	)
}
