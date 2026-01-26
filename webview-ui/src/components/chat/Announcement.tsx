import { memo, type ReactNode, useState } from "react"
import { Trans } from "react-i18next"
import { SiDiscord, SiReddit, SiX } from "react-icons/si"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { Package } from "@roo/package"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@src/components/ui"

interface AnnouncementProps {
	hideAnnouncement: () => void
}

/**
 * You must update the `latestAnnouncementId` in ClineProvider for new
 * announcements to show to users. This new id will be compared with what's in
 * state for the 'last announcement shown', and if it's different then the
 * announcement will render. As soon as an announcement is shown, the id will be
 * updated in state. This ensures that announcements are not shown more than
 * once, even if the user doesn't close it themselves.
 */

const Announcement = ({ hideAnnouncement }: AnnouncementProps) => {
	const { t } = useAppTranslation()
	const [open, setOpen] = useState(true)

	return (
		<Dialog
			open={open}
			onOpenChange={(open) => {
				setOpen(open)

				if (!open) {
					hideAnnouncement()
				}
			}}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("chat:announcement.title", { version: Package.version })}</DialogTitle>
				</DialogHeader>
				<div>
					{/* Regular Release Highlights */}
					<div className="mb-4">
						<p className="mb-3">{t("chat:announcement.release.heading")}</p>
						<ul className="list-disc list-inside text-sm space-y-1.5">
							<li>{t("chat:announcement.release.openaiCodexProvider")}</li>
							<li>{t("chat:announcement.release.gpt52codexModel")}</li>
							<li>{t("chat:announcement.release.bugFixes")}</li>
						</ul>
					</div>

					<div className="mt-4 text-sm text-center text-vscode-descriptionForeground">
						<div className="flex items-center justify-center gap-4">
							<SocialLink
								icon={<SiX className="w-4 h-4" aria-hidden />}
								label="X"
								href="https://x.com/roocode"
							/>
							<SocialLink
								icon={<SiDiscord className="w-4 h-4" aria-hidden />}
								label="Discord"
								href="https://discord.gg/rCQcvT7Fnt"
							/>
							<SocialLink
								icon={<SiReddit className="w-4 h-4" aria-hidden />}
								label="Reddit"
								href="https://www.reddit.com/r/RooCode/"
							/>
						</div>
					</div>

					<div className="mt-3 text-sm text-center text-vscode-descriptionForeground">
						<Trans i18nKey="chat:announcement.support" components={{ githubLink: <GitHubLink /> }} />
					</div>

					{/* Careers Section */}
					<div className="mt-2 text-sm text-center">
						<Trans
							i18nKey="chat:announcement.careers"
							components={{
								careersLink: <CareersLink />,
							}}
						/>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}

const SocialLink = ({ icon, label, href }: { icon: ReactNode; label: string; href: string }) => (
	<VSCodeLink
		href={href}
		className="inline-flex items-center gap-1"
		onClick={(e) => {
			e.preventDefault()
			vscode.postMessage({ type: "openExternal", url: href })
		}}>
		{icon}
		<span className="sr-only">{label}</span>
	</VSCodeLink>
)

const GitHubLink = ({ children }: { children?: ReactNode }) => (
	<VSCodeLink
		href="https://github.com/RooCodeInc/Roo-Code"
		onClick={(e) => {
			e.preventDefault()
			vscode.postMessage({ type: "openExternal", url: "https://github.com/RooCodeInc/Roo-Code" })
		}}>
		{children}
	</VSCodeLink>
)

const CareersLink = ({ children }: { children?: ReactNode }) => (
	<VSCodeLink
		href="https://careers.roocode.com"
		onClick={(e) => {
			e.preventDefault()
			vscode.postMessage({ type: "openExternal", url: "https://careers.roocode.com" })
		}}>
		{children}
	</VSCodeLink>
)

export default memo(Announcement)
// kilocode_change: file unused, no need to touch anything
