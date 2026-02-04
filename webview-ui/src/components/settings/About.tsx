import {
	HTMLAttributes,
	useState, // kilocode_change
} from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"
import { Download, Upload, TriangleAlert, Bug, Lightbulb, Shield, MessageCircle, MessagesSquare } from "lucide-react"
import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import type { TelemetrySetting } from "@roo-code/types"

import { Package } from "@roo/package"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"

type AboutProps = HTMLAttributes<HTMLDivElement> & {
	telemetrySetting: TelemetrySetting
	setTelemetrySetting: (setting: TelemetrySetting) => void
	debug?: boolean
	setDebug?: (debug: boolean) => void
}

export const About = ({ telemetrySetting, setTelemetrySetting, debug, setDebug, className, ...props }: AboutProps) => {
	const { t } = useAppTranslation()

	const [kiloCodeBloat, setKiloCodeBloat] = useState<number[][]>([])

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>{t("settings:sections.about")}</SectionHeader>

			<Section>
				<p>
					{Package.sha
						? `Version: ${Package.version} (${Package.sha.slice(0, 8)})`
						: `Version: ${Package.version}`}
				</p>
				<SearchableSetting
					settingId="about-telemetry"
					section="about"
					label={t("settings:footer.telemetry.label")}>
					<VSCodeCheckbox
						checked={telemetrySetting !== "disabled"}
						onChange={(e: any) => {
							const checked = e.target.checked === true
							setTelemetrySetting(checked ? "enabled" : "disabled")
						}}>
						{t("settings:footer.telemetry.label")}
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						<Trans
							i18nKey="settings:footer.telemetry.description"
							components={{
								privacyLink: <VSCodeLink href="https://kilo.ai/privacy" />,
							}}
						/>
					</p>
				</SearchableSetting>
			</Section>

			<Section className="space-y-0">
				<h3>{t("settings:about.contactAndCommunity")}</h3>
				<div className="flex flex-col gap-3">
					<div className="flex items-start gap-2">
						<Bug className="size-4 text-vscode-descriptionForeground shrink-0" />
						<span>
							{t("settings:about.bugReport.label")}{" "}
							<VSCodeLink href="https://github.com/RooCodeInc/Roo-Code/issues/new?template=bug_report.yml">
								{t("settings:about.bugReport.link")}
							</VSCodeLink>
						</span>
					</div>
					<div className="flex items-start gap-2">
						<Lightbulb className="size-4 text-vscode-descriptionForeground shrink-0" />
						<span>
							{t("settings:about.featureRequest.label")}{" "}
							<VSCodeLink href="https://github.com/RooCodeInc/Roo-Code/issues/new?template=feature_request.yml">
								{t("settings:about.featureRequest.link")}
							</VSCodeLink>
						</span>
					</div>
					<div className="flex items-start gap-2">
						<Shield className="size-4 text-vscode-descriptionForeground shrink-0" />
						<span>
							{t("settings:about.securityIssue.label")}{" "}
							<VSCodeLink href="https://github.com/RooCodeInc/Roo-Code/security/policy">
								{t("settings:about.securityIssue.link")}
							</VSCodeLink>
						</span>
					</div>
					<div className="flex items-start gap-2">
						<MessageCircle className="size-4 text-vscode-descriptionForeground shrink-0" />
						<span>
							{t("settings:about.contact.label")}{" "}
							<VSCodeLink href="mailto:support@roocode.com">support@roocode.com</VSCodeLink>
						</span>
					</div>
					<div className="flex items-start gap-2">
						<MessagesSquare className="size-4 text-vscode-descriptionForeground shrink-0" />
						<span>
							<Trans
								i18nKey="settings:about.community"
								components={{
									redditLink: <VSCodeLink href="https://reddit.com/r/RooCode" />,
									discordLink: <VSCodeLink href="https://discord.gg/roocode" />,
								}}
							/>
						</span>
					</div>
					{setDebug && (
						<SearchableSetting
							settingId="about-debug-mode"
							section="about"
							label={t("settings:about.debugMode.label")}
							className="mt-4 pt-4 border-t border-vscode-settings-headerBorder">
							<VSCodeCheckbox
								checked={debug ?? false}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									setDebug(checked)
								}}>
								{t("settings:about.debugMode.label")}
							</VSCodeCheckbox>
							<p className="text-vscode-descriptionForeground text-sm mt-0">
								{t("settings:about.debugMode.description")}
							</p>
						</SearchableSetting>
					)}
				</div>

			<Section className="space-y-0">
				<SearchableSetting
					settingId="about-manage-settings"
					section="about"
					label={t("settings:about.manageSettings")}>
					<h3>{t("settings:about.manageSettings")}</h3>
					<div className="flex flex-wrap items-center gap-2">
						<Button onClick={() => vscode.postMessage({ type: "exportSettings" })} className="w-28">
							<Upload className="p-0.5" />
							{t("settings:footer.settings.export")}
						</Button>
						<Button onClick={() => vscode.postMessage({ type: "importSettings" })} className="w-28">
							<Download className="p-0.5" />
							{t("settings:footer.settings.import")}
						</Button>
						<Button
							variant="destructive"
							onClick={() => vscode.postMessage({ type: "resetState" })}
							className="w-28">
							<TriangleAlert className="p-0.5" />
							{t("settings:footer.settings.reset")}
						</Button>
					</div>
				</SearchableSetting>
			</Section>
		</div>
	)
}
