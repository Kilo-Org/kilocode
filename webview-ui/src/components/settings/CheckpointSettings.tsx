import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox, VSCodeLink, VSCodeTextField, VSCodeButton } from "@vscode/webview-ui-toolkit/react" // kilocode_change
import { GitBranch, Trash2, Clock } from "lucide-react" // kilocode_change
import { Trans } from "react-i18next"
import { buildDocLink } from "@src/utils/docLinks"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type CheckpointSettingsProps = HTMLAttributes<HTMLDivElement> & {
	enableCheckpoints?: boolean
	// kilocode_change start
	autoPurgeEnabled?: boolean
	autoPurgeDefaultRetentionDays?: number
	autoPurgeFavoritedTaskRetentionDays?: number | null
	autoPurgeCompletedTaskRetentionDays?: number
	autoPurgeIncompleteTaskRetentionDays?: number
	autoPurgeLastRunTimestamp?: number
	setCachedStateField: SetCachedStateField<
		| "enableCheckpoints"
		| "autoPurgeEnabled"
		| "autoPurgeDefaultRetentionDays"
		| "autoPurgeFavoritedTaskRetentionDays"
		| "autoPurgeCompletedTaskRetentionDays"
		| "autoPurgeIncompleteTaskRetentionDays"
	>
	onManualPurge?: () => void
	// kilocode_change end
}

export const CheckpointSettings = ({
	enableCheckpoints,
	// kilocode_change start
	autoPurgeEnabled,
	autoPurgeDefaultRetentionDays,
	autoPurgeFavoritedTaskRetentionDays,
	autoPurgeCompletedTaskRetentionDays,
	autoPurgeIncompleteTaskRetentionDays,
	autoPurgeLastRunTimestamp,
	setCachedStateField,
	onManualPurge,
	// kilocode_change end
	...props
}: CheckpointSettingsProps) => {
	const { t } = useAppTranslation()
	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<GitBranch className="w-4" />
					<div>{t("settings:sections.checkpoints")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<VSCodeCheckbox
						checked={enableCheckpoints}
						onChange={(e: any) => {
							setCachedStateField("enableCheckpoints", e.target.checked)
						}}>
						<span className="font-medium">{t("settings:checkpoints.enable.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						<Trans i18nKey="settings:checkpoints.enable.description">
							<VSCodeLink
								href={buildDocLink("features/checkpoints", "settings_checkpoints")}
								style={{ display: "inline" }}>
								{" "}
							</VSCodeLink>
						</Trans>
					</div>
				</div>
			</Section>
			{/* kilocode_change start - Auto-Purge Settings Section */}
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Trash2 className="w-4" />
					<div>{t("settings:sections.autoPurge")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div className="space-y-4">
					<div>
						<VSCodeCheckbox
							checked={autoPurgeEnabled}
							onChange={(e: any) => {
								setCachedStateField("autoPurgeEnabled", e.target.checked)
							}}>
							<span className="font-medium">{t("settings:autoPurge.enable.label")}</span>
						</VSCodeCheckbox>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							{t("settings:autoPurge.enable.description")}
						</div>
					</div>

					{autoPurgeEnabled && (
						<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
							<div>
								<label className="block text-sm font-medium mb-1">
									{t("settings:autoPurge.defaultRetention.label")}
								</label>
								<VSCodeTextField
									value={String(autoPurgeDefaultRetentionDays || 30)}
									onInput={(e: any) => {
										const value = parseInt(e.target.value) || 30
										setCachedStateField("autoPurgeDefaultRetentionDays", Math.max(1, value))
									}}
									placeholder="30"
								/>
								<div className="text-vscode-descriptionForeground text-xs mt-1">
									{t("settings:autoPurge.defaultRetention.description")}
								</div>
							</div>

							<div>
								<VSCodeCheckbox
									checked={autoPurgeFavoritedTaskRetentionDays === null}
									onChange={(e: any) => {
										setCachedStateField(
											"autoPurgeFavoritedTaskRetentionDays",
											e.target.checked ? null : 90,
										)
									}}>
									<span className="font-medium">
										{t("settings:autoPurge.neverPurgeFavorited.label")}
									</span>
								</VSCodeCheckbox>
								<div className="text-vscode-descriptionForeground text-sm mt-1">
									{t("settings:autoPurge.neverPurgeFavorited.description")}
								</div>
							</div>

							{autoPurgeFavoritedTaskRetentionDays !== null && (
								<div className="ml-6">
									<label className="block text-sm font-medium mb-1">
										{t("settings:autoPurge.favoritedRetention.label")}
									</label>
									<VSCodeTextField
										value={String(autoPurgeFavoritedTaskRetentionDays || 90)}
										onInput={(e: any) => {
											const value = parseInt(e.target.value) || 90
											setCachedStateField(
												"autoPurgeFavoritedTaskRetentionDays",
												Math.max(1, value),
											)
										}}
										placeholder="90"
									/>
								</div>
							)}

							<div>
								<label className="block text-sm font-medium mb-1">
									{t("settings:autoPurge.completedRetention.label")}
								</label>
								<VSCodeTextField
									value={String(autoPurgeCompletedTaskRetentionDays || 30)}
									onInput={(e: any) => {
										const value = parseInt(e.target.value) || 30
										setCachedStateField("autoPurgeCompletedTaskRetentionDays", Math.max(1, value))
									}}
									placeholder="30"
								/>
								<div className="text-vscode-descriptionForeground text-xs mt-1">
									{t("settings:autoPurge.completedRetention.description")}
								</div>
							</div>

							<div>
								<label className="block text-sm font-medium mb-1">
									{t("settings:autoPurge.incompleteRetention.label")}
								</label>
								<VSCodeTextField
									value={String(autoPurgeIncompleteTaskRetentionDays || 7)}
									onInput={(e: any) => {
										const value = parseInt(e.target.value) || 7
										setCachedStateField("autoPurgeIncompleteTaskRetentionDays", Math.max(1, value))
									}}
									placeholder="7"
								/>
								<div className="text-vscode-descriptionForeground text-xs mt-1">
									{t("settings:autoPurge.incompleteRetention.description")}
								</div>
							</div>

							<div className="flex items-center justify-between pt-2">
								<div>
									{autoPurgeLastRunTimestamp && (
										<div className="text-vscode-descriptionForeground text-sm">
											<Clock className="w-3 h-3 inline mr-1" />
											{t("settings:autoPurge.lastRun.label")}:{" "}
											{new Date(autoPurgeLastRunTimestamp).toLocaleDateString()}
										</div>
									)}
								</div>
								<VSCodeButton onClick={onManualPurge} appearance="secondary">
									{t("settings:autoPurge.manualPurge.button")}
								</VSCodeButton>
							</div>
						</div>
					)}
				</div>
			</Section>
			{/* kilocode_change end - Auto-Purge Settings Section */}
		</div>
	)
}
