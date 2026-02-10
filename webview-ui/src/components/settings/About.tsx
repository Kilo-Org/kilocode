import {
	HTMLAttributes,
	useState, // kilocode_change
} from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"
import { Info, Download, Upload, TriangleAlert } from "lucide-react"
import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import type { TelemetrySetting } from "@roo-code/types"

import { Package } from "@roo/package"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { getMemoryPercentage } from "@/kilocode/helpers"

type AboutProps = HTMLAttributes<HTMLDivElement> & {
	telemetrySetting: TelemetrySetting
	setTelemetrySetting: (setting: TelemetrySetting) => void
	isVsCode: boolean // kilocode_change
}

export const About = ({
	telemetrySetting,
	setTelemetrySetting,
	className,
	isVsCode, // kilocode_change
	...props
}: AboutProps) => {
	const { t } = useAppTranslation()

	const [kiloCodeBloat, setKiloCodeBloat] = useState<number[][]>([])

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader
				description={
					Package.sha
						? `Version: ${Package.version} (${Package.sha.slice(0, 8)})`
						: `Version: ${Package.version}`
				}>
				<div className="flex items-center gap-2">
					<Info className="w-4" />
					<div>{t("settings:sections.about")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div style={{ display: isVsCode ? "none" : undefined }}>
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
				</div>

				<div>
					<Trans
						i18nKey="settings:footer.feedback"
						components={{
							githubLink: <VSCodeLink href="https://github.com/Kilo-Org/kilocode" />,
							redditLink: <VSCodeLink href="https://reddit.com/r/kilocode" />,
							discordLink: <VSCodeLink href="https://kilo.ai/discord" />,
						}}
					/>
				</div>

				{/* kilocode_change start */}
				<div>
					<Trans
						i18nKey="settings:footer.support"
						components={{
							supportLink: <VSCodeLink href="https://kilo.ai/support" />,
						}}
					/>
				</div>
				{/* kilocode_change end */}

				<div className="flex flex-wrap items-center gap-2 mt-2">
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

				{
					// kilocode_change start
					process.env.NODE_ENV === "development" && (
						<div className="flex flex-wrap items-center gap-2 mt-2">
							<Button
								variant="destructive"
								onClick={() => {
									setKiloCodeBloat([...kiloCodeBloat, new Array<number>(20_000_000).fill(0)])
									console.debug(`Memory percentage: ${getMemoryPercentage()}`)
								}}>
								Development: Allocate memory
							</Button>
						</div>
					)
					// kilocode_change end
				}
			</Section>
		</div>
	)
}
