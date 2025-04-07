import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"
import { Info, Download, Upload, TriangleAlert } from "lucide-react"

import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type AboutProps = HTMLAttributes<HTMLDivElement> & {
	version: string
}

export const About = ({ version, className, ...props }: AboutProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader description={`Version: ${version}`}>
				<div className="flex items-center gap-2">
					<Info className="w-4" />
					<div>{t("settings:sections.about")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<Trans
						i18nKey="settings:footer.feedback"
						components={{
							githubLink: <VSCodeLink href="https://github.com/Kilo-Org/kilocode" />,
							redditLink: <VSCodeLink href="https://reddit.com/r/kilocode" />,
							discordLink: <VSCodeLink href="https://kilocode.ai/discord" />,
						}}
					/>
				</div>

				<div className="flex items-center gap-2 mt-2">
					<Button onClick={() => vscode.postMessage({ type: "exportSettings" })}>
						<Upload className="p-0.5" />
						{t("settings:footer.settings.export")}
					</Button>
					<Button onClick={() => vscode.postMessage({ type: "importSettings" })}>
						<Download className="p-0.5" />
						{t("settings:footer.settings.import")}
					</Button>
					<Button variant="destructive" onClick={() => vscode.postMessage({ type: "resetState" })}>
						<TriangleAlert className="p-0.5" />
						{t("settings:footer.settings.reset")}
					</Button>
				</div>
			</Section>
		</div>
	)
}
