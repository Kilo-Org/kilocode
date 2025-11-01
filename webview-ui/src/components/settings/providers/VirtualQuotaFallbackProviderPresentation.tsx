import { useCallback } from "react"
import { Trans, useTranslation } from "react-i18next"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { PlusIcon, TrashIcon } from "@radix-ui/react-icons"
import { ChevronUp, ChevronDown } from "lucide-react"

import { type ProviderSettingsEntry } from "@roo-code/types"
import { LabeledProgress, SearchableSelect } from "@src/components/ui"
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
import { UsageResultByDuration } from "@roo-code/types"
import { inputEventTransform } from "../transforms"
import { VirtualQuotaFallbackProviderData } from "./VirtualQuotaFallbackProvider"

interface VirtualQuotaFallbackProviderPresentationProps {
	profiles: VirtualQuotaFallbackProviderData[]
	availableProfiles: ProviderSettingsEntry[]
	isAlertOpen: boolean
	usageData: Record<string, UsageResultByDuration>
	onProfileChange: (index: number, profile: VirtualQuotaFallbackProviderData) => void
	onProfileSelect: (index: number, selectedId: string) => void
	onAddProfile: () => void
	onRemoveProfile: (index: number) => void
	onMoveProfileUp: (index: number) => void
	onMoveProfileDown: (index: number) => void
	onClearUsageData: () => void
	onSetIsAlertOpen: (open: boolean) => void
	getUsedProfileIds: (excludeIndex: number) => string[]
}

export const VirtualQuotaFallbackProviderPresentation = ({
	profiles,
	availableProfiles,
	isAlertOpen,
	usageData,
	onProfileChange,
	onProfileSelect,
	onAddProfile,
	onRemoveProfile,
	onMoveProfileUp,
	onMoveProfileDown,
	onClearUsageData,
	onSetIsAlertOpen,
	getUsedProfileIds,
}: VirtualQuotaFallbackProviderPresentationProps) => {
	const { t } = useTranslation()

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
										onClick={() => onMoveProfileUp(index)}
										disabled={index === 0}
										title={t("kilocode:virtualProvider.moveProfileUp")}>
										<ChevronUp size={16} />
									</VSCodeButton>
									{/* Move Down Button */}
									<VSCodeButton
										appearance="icon"
										onClick={() => onMoveProfileDown(index)}
										disabled={index === profiles.length - 1}
										title={t("kilocode:virtualProvider.moveProfileDown")}>
										<ChevronDown size={16} />
									</VSCodeButton>
									{/* Remove Button */}
									{profiles.length > 1 && (
										<VSCodeButton
											appearance="icon"
											onClick={() => onRemoveProfile(index)}
											title={t("kilocode:virtualProvider.removeProfile")}>
											<TrashIcon />
										</VSCodeButton>
									)}
								</div>
							</div>
							<SearchableSelect
								value={profile.profileId || ""}
								onValueChange={(value) => onProfileSelect(index, value)}
								disabled={availableForThisSlot.length === 0}
								options={availableForThisSlot.map((p) => ({
									value: p.id,
									label: p.name,
								}))}
								placeholder={t("kilocode:virtualProvider.selectProfilePlaceholder")}
								searchPlaceholder={t("settings:providers.searchPlaceholder")}
								emptyMessage={t("settings:providers.noMatchFound")}
								className="w-full"
							/>
							<VirtualLimitInputsPresentation
								profile={profile}
								index={index}
								onProfileChange={onProfileChange}
								usage={profile.profileId ? usageData[profile.profileId] : null}
							/>
						</div>
					)
				})}

				<div className="flex justify-center p-4">
					<VSCodeButton
						appearance="secondary"
						onClick={onAddProfile}
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
				<VSCodeButton appearance="secondary" onClick={() => onSetIsAlertOpen(true)}>
					<Trans i18nKey="kilocode:virtualProvider.clearUsageData">Clear Usage Data</Trans>
				</VSCodeButton>
			</div>

			<AlertDialog open={isAlertOpen} onOpenChange={onSetIsAlertOpen}>
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
						<AlertDialogAction onClick={onClearUsageData}>
							<Trans i18nKey="common:confirm">Confirm</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}

interface LimitInputsProps {
	profile: VirtualQuotaFallbackProviderData
	index: number
	onProfileChange: (index: number, profile: VirtualQuotaFallbackProviderData) => void
	usage?: UsageResultByDuration | null
}

export const VirtualLimitInputsPresentation = ({ profile, index, onProfileChange, usage }: LimitInputsProps) => {
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

	const renderProgressBarForLimit = useCallback(
		(
			limitType: keyof NonNullable<VirtualQuotaFallbackProviderData["profileLimits"]>,
			usageKey: "tokens" | "requests",
			duration: "minute" | "hour" | "day",
		) => {
			const limit = profile.profileLimits?.[limitType]
			if (!limit || !usage) return null

			const current = usage[duration][usageKey]

			return (
				<div className="mt-1">
					<LabeledProgress label="" currentValue={current} limitValue={limit} />
				</div>
			)
		},
		[profile.profileLimits, usage],
	)

	if (!profile.profileId) {
		return null
	}

	return (
		<div className="space-y-4 p-2 rounded-md mt-2">
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
							className="[--input-min-width:100%]"
						/>
						{renderProgressBarForLimit("tokensPerMinute", "tokens", "minute")}
					</div>
					<div>
						<label className="block text-xs text-vscode-descriptionForeground mb-1">
							<Trans i18nKey="kilocode:virtualProvider.perHour">Per Hour</Trans>
						</label>
						<VSCodeTextField
							value={profile.profileLimits?.tokensPerHour?.toString() ?? ""}
							onInput={handleLimitChange("tokensPerHour")}
							className="[--input-min-width:100%]"
						/>
						{renderProgressBarForLimit("tokensPerHour", "tokens", "hour")}
					</div>
					<div>
						<label className="block text-xs text-vscode-descriptionForeground mb-1">
							<Trans i18nKey="kilocode:virtualProvider.perDay">Per Day</Trans>
						</label>
						<VSCodeTextField
							value={profile.profileLimits?.tokensPerDay?.toString() ?? ""}
							onInput={handleLimitChange("tokensPerDay")}
							className="[--input-min-width:100%]"
						/>
						{renderProgressBarForLimit("tokensPerDay", "tokens", "day")}
					</div>
				</div>
			</div>

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
							className="[--input-min-width:100%]"
						/>
						{renderProgressBarForLimit("requestsPerMinute", "requests", "minute")}
					</div>
					<div>
						<label className="block text-xs text-vscode-descriptionForeground mb-1">
							<Trans i18nKey="kilocode:virtualProvider.perHour">Per Hour</Trans>
						</label>
						<VSCodeTextField
							value={profile.profileLimits?.requestsPerHour?.toString() ?? ""}
							onInput={handleLimitChange("requestsPerHour")}
							className="[--input-min-width:100%]"
						/>
						{renderProgressBarForLimit("requestsPerHour", "requests", "hour")}
					</div>
					<div>
						<label className="block text-xs text-vscode-descriptionForeground mb-1">
							<Trans i18nKey="kilocode:virtualProvider.perDay">Per Day</Trans>
						</label>
						<VSCodeTextField
							value={profile.profileLimits?.requestsPerDay?.toString() ?? ""}
							onInput={handleLimitChange("requestsPerDay")}
							className="[--input-min-width:100%]"
						/>
						{renderProgressBarForLimit("requestsPerDay", "requests", "day")}
					</div>
				</div>
			</div>
		</div>
	)
}
