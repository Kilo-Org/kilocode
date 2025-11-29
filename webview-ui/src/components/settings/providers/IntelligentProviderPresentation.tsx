import { Trans, useTranslation } from "react-i18next"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { TrashIcon } from "@radix-ui/react-icons"

import { type ProviderSettingsEntry } from "@roo-code/types"
import { SearchableSelect } from "@src/components/ui"
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
import { IntelligentProfileData, type IntelligentProviderConfig } from "./IntelligentProvider"

interface IntelligentProviderPresentationProps {
	config: IntelligentProviderConfig
	availableProfiles: ProviderSettingsEntry[]
	isAlertOpen: boolean
	onProfileChange: (
		profileType: "easyProfile" | "mediumProfile" | "hardProfile" | "classifierProfile",
		profile: IntelligentProfileData,
	) => void
	onProfileSelect: (
		profileType: "easyProfile" | "mediumProfile" | "hardProfile" | "classifierProfile",
		selectedId: string,
	) => void
	onClearUsageData: () => void
	onSetIsAlertOpen: (open: boolean) => void
}

export const IntelligentProviderPresentation = ({
	config,
	availableProfiles,
	isAlertOpen,
	onProfileChange,
	onProfileSelect,
	onClearUsageData,
	onSetIsAlertOpen,
}: IntelligentProviderPresentationProps) => {
	const { t } = useTranslation()

	// Allow the same profile to be used for multiple difficulty levels
	// No filtering needed - users can select any available profile for any difficulty level

	const handleClearProfile = (profileType: "easyProfile" | "mediumProfile" | "hardProfile" | "classifierProfile") => {
		onProfileChange(profileType, {})
	}

	const getAvailableProfilesForType = (
		_profileType: "easyProfile" | "mediumProfile" | "hardProfile" | "classifierProfile",
	) => {
		// Allow selecting any available profile for any difficulty level
		return availableProfiles
	}

	return (
		<>
			<h3 className="text-lg font-medium mb-0">
				<Trans i18nKey="kilocode:intelligentProvider.title">Intelligent Provider Settings</Trans>
			</h3>
			<div className="text-sm text-vscode-descriptionForeground mb-4">
				<Trans i18nKey="kilocode:intelligentProvider.description">
					Configure three profiles for different difficulty levels. The system will automatically select the
					appropriate provider based on the complexity of your request.
				</Trans>
			</div>

			{/* Easy Profile */}
			<div className="border border-vscode-settings-sashBorder rounded-md p-2 mb-3">
				<div className="flex items-center justify-between mb-2">
					<label className="block font-medium">
						<Trans i18nKey="kilocode:intelligentProvider.easyProfileLabel">Easy Profile</Trans>
					</label>
					{config.easyProfile?.profileId && (
						<VSCodeButton
							appearance="icon"
							onClick={() => handleClearProfile("easyProfile")}
							title={t("kilocode:intelligentProvider.clearProfile")}>
							<TrashIcon />
						</VSCodeButton>
					)}
				</div>
				<SearchableSelect
					value={config.easyProfile?.profileId || ""}
					onValueChange={(value) => onProfileSelect("easyProfile", value)}
					disabled={getAvailableProfilesForType("easyProfile").length === 0}
					options={getAvailableProfilesForType("easyProfile").map((p) => ({
						value: p.id,
						label: p.name,
					}))}
					placeholder={t("kilocode:intelligentProvider.selectProfilePlaceholder")}
					searchPlaceholder={t("settings:providers.searchPlaceholder")}
					emptyMessage={t("settings:providers.noMatchFound")}
					className="w-full"
				/>
				<p className="text-xs text-vscode-descriptionForeground mt-1">
					<Trans i18nKey="kilocode:intelligentProvider.easyProfileDescription">
						Used for simple requests like quick explanations, basic summaries, or simple code snippets.
					</Trans>
				</p>
			</div>

			{/* Medium Profile */}
			<div className="border border-vscode-settings-sashBorder rounded-md p-2 mb-3">
				<div className="flex items-center justify-between mb-2">
					<label className="block font-medium">
						<Trans i18nKey="kilocode:intelligentProvider.mediumProfileLabel">Medium Profile</Trans>
					</label>
					{config.mediumProfile?.profileId && (
						<VSCodeButton
							appearance="icon"
							onClick={() => handleClearProfile("mediumProfile")}
							title={t("kilocode:intelligentProvider.clearProfile")}>
							<TrashIcon />
						</VSCodeButton>
					)}
				</div>
				<SearchableSelect
					value={config.mediumProfile?.profileId || ""}
					onValueChange={(value) => onProfileSelect("mediumProfile", value)}
					disabled={getAvailableProfilesForType("mediumProfile").length === 0}
					options={getAvailableProfilesForType("mediumProfile").map((p) => ({
						value: p.id,
						label: p.name,
					}))}
					placeholder={t("kilocode:intelligentProvider.selectProfilePlaceholder")}
					searchPlaceholder={t("settings:providers.searchPlaceholder")}
					emptyMessage={t("settings:providers.noMatchFound")}
					className="w-full"
				/>
				<p className="text-xs text-vscode-descriptionForeground mt-1">
					<Trans i18nKey="kilocode:intelligentProvider.mediumProfileDescription">
						Used for moderate requests like code analysis, implementation suggestions, or moderate
						complexity tasks.
					</Trans>
				</p>
			</div>

			{/* Hard Profile */}
			<div className="border border-vscode-settings-sashBorder rounded-md p-2 mb-3">
				<div className="flex items-center justify-between mb-2">
					<label className="block font-medium">
						<Trans i18nKey="kilocode:intelligentProvider.hardProfileLabel">Hard Profile</Trans>
					</label>
					{config.hardProfile?.profileId && (
						<VSCodeButton
							appearance="icon"
							onClick={() => handleClearProfile("hardProfile")}
							title={t("kilocode:intelligentProvider.clearProfile")}>
							<TrashIcon />
						</VSCodeButton>
					)}
				</div>
				<SearchableSelect
					value={config.hardProfile?.profileId || ""}
					onValueChange={(value) => onProfileSelect("hardProfile", value)}
					disabled={getAvailableProfilesForType("hardProfile").length === 0}
					options={getAvailableProfilesForType("hardProfile").map((p) => ({
						value: p.id,
						label: p.name,
					}))}
					placeholder={t("kilocode:intelligentProvider.selectProfilePlaceholder")}
					searchPlaceholder={t("settings:providers.searchPlaceholder")}
					emptyMessage={t("settings:providers.noMatchFound")}
					className="w-full"
				/>
				<p className="text-xs text-vscode-descriptionForeground mt-1">
					<Trans i18nKey="kilocode:intelligentProvider.hardProfileDescription">
						Used for complex requests like architecture design, complex debugging, or advanced problem
						solving.
					</Trans>
				</p>
			</div>

			{/* Classifier Profile */}
			<div className="border border-vscode-settings-sashBorder rounded-md p-2 mb-3">
				<div className="flex items-center justify-between mb-2">
					<label className="block font-medium">
						<Trans i18nKey="kilocode:intelligentProvider.classifierProfileLabel">Classifier Profile</Trans>
					</label>
					{config.classifierProfile?.profileId && (
						<VSCodeButton
							appearance="icon"
							onClick={() => handleClearProfile("classifierProfile")}
							title={t("kilocode:intelligentProvider.clearProfile")}>
							<TrashIcon />
						</VSCodeButton>
					)}
				</div>
				<SearchableSelect
					value={config.classifierProfile?.profileId || ""}
					onValueChange={(value) => onProfileSelect("classifierProfile", value)}
					disabled={getAvailableProfilesForType("classifierProfile").length === 0}
					options={getAvailableProfilesForType("classifierProfile").map((p) => ({
						value: p.id,
						label: p.name,
					}))}
					placeholder={t("kilocode:intelligentProvider.selectProfilePlaceholder")}
					searchPlaceholder={t("settings:providers.searchPlaceholder")}
					emptyMessage={t("settings:providers.noMatchFound")}
					className="w-full"
				/>
				<p className="text-xs text-vscode-descriptionForeground mt-1">
					<Trans i18nKey="kilocode:intelligentProvider.classifierProfileDescription">
						Specifies which profile to use for difficulty classification. If not set, defaults to using the
						easy profile.
					</Trans>
				</p>
			</div>

			{availableProfiles.length === 0 ? (
				<div className="text-sm text-vscode-descriptionForeground text-center p-4 border-vscode-settings-sashBorder rounded-md">
					<Trans i18nKey="kilocode:intelligentProvider.noProfilesAvailable">
						No profiles available. Please configure at least one non-intelligent profile first.
					</Trans>
				</div>
			) : null}

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
