import { HTMLAttributes } from "react" // kilocode_change
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Bell } from "lucide-react"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { Slider } from "../ui"
import { vscode } from "../../utils/vscode"
import { Button } from "vscrui"

type NotificationSettingsProps = HTMLAttributes<HTMLDivElement> & {
	ttsEnabled?: boolean
	ttsSpeed?: number
	soundEnabled?: boolean
	soundVolume?: number
	systemNotificationsEnabled?: boolean // kilocode_change
	areSettingsCommitted?: boolean // kilocode_change
	setCachedStateField: SetCachedStateField<
		"ttsEnabled" | "ttsSpeed" | "soundEnabled" | "soundVolume" | "systemNotificationsEnabled"
	>
}

export const NotificationSettings = ({
	ttsEnabled,
	ttsSpeed,
	soundEnabled,
	soundVolume,
	systemNotificationsEnabled, // kilocode_change
	areSettingsCommitted, // kilocode_change
	setCachedStateField,
	...props
}: NotificationSettingsProps) => {
	const { t } = useAppTranslation()

	// kilocode_change start
	const onTestNotificationClick = () => {
		vscode.postMessage({
			type: "showSystemNotification",
			notificationOptions: {
				title: t("kilocode:settings.systemNotifications.testTitle"),
				message: t("kilocode:settings.systemNotifications.testMessage"),
			},
			alwaysAllow: true,
		})
	}
	// kilocode_change end

	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Bell className="w-4" />
					<div>{t("settings:sections.notifications")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<VSCodeCheckbox
						checked={ttsEnabled}
						onChange={(e: any) => setCachedStateField("ttsEnabled", e.target.checked)}
						data-testid="tts-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.tts.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:notifications.tts.description")}
					</div>
				</div>

				{ttsEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div>
							<label className="block font-medium mb-1">
								{t("settings:notifications.tts.speedLabel")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={0.1}
									max={2.0}
									step={0.01}
									value={[ttsSpeed ?? 1.0]}
									onValueChange={([value]) => setCachedStateField("ttsSpeed", value)}
									data-testid="tts-speed-slider"
								/>
								<span className="w-10">{((ttsSpeed ?? 1.0) * 100).toFixed(0)}%</span>
							</div>
						</div>
					</div>
				)}

				<div>
					<VSCodeCheckbox
						checked={soundEnabled}
						onChange={(e: any) => setCachedStateField("soundEnabled", e.target.checked)}
						data-testid="sound-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.sound.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:notifications.sound.description")}
					</div>
				</div>

				{soundEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div>
							<label className="block font-medium mb-1">
								{t("settings:notifications.sound.volumeLabel")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={0}
									max={1}
									step={0.01}
									value={[soundVolume ?? 0.5]}
									onValueChange={([value]) => setCachedStateField("soundVolume", value)}
									data-testid="sound-volume-slider"
								/>
								<span className="w-10">{((soundVolume ?? 0.5) * 100).toFixed(0)}%</span>
							</div>
						</div>
					</div>
				)}

				{/* kilocode_change start */}
				<div>
					<VSCodeCheckbox
						checked={systemNotificationsEnabled}
						onChange={(e: any) => setCachedStateField("systemNotificationsEnabled", e.target.checked)}
						data-testid="system-notifications-enabled-checkbox">
						<span className="font-medium">{t("kilocode:settings.systemNotifications.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("kilocode:settings.systemNotifications.description")}
					</div>
				</div>
				{systemNotificationsEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<Button
							className="w-fit text-vscode-button-background hover:text-vscode-button-hoverBackground"
							onClick={onTestNotificationClick}>
							{t("kilocode:settings.systemNotifications.testButton")}
						</Button>
					</div>
				)}
				{/* kilocode_change end */}
			</Section>
		</div>
	)
}
