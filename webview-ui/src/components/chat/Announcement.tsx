import { useState, memo } from "react"
import { Trans } from "react-i18next"
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
			<DialogContent className="max-w-96">
				<DialogHeader>
					<DialogTitle>{t("chat:announcement.title", { version: Package.version })}</DialogTitle>
				</DialogHeader>
				<div>
					{/* Regular Release Highlights */}
					<div className="mb-4">
						<p className="mb-3">{t("chat:announcement.release.heading")}</p>
						<ul className="list-disc list-inside text-sm space-y-1.5">
							<li>{t("chat:announcement.release.contextRewind")}</li>
							<li>{t("chat:announcement.release.rooProvider")}</li>
						</ul>
					</div>

					<div className="mt-4 text-sm text-center">
						<Trans
							i18nKey="chat:announcement.socialLinks"
							components={{
								xLink: <XLink />,
								discordLink: <DiscordLink />,
								redditLink: <RedditLink />,
							}}
						/>
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

const XLink = () => (
	<VSCodeLink
		href="https://x.com/roocode"
		onClick={(e) => {
			e.preventDefault()
			vscode.postMessage({ type: "openExternal", url: "https://x.com/roocode" })
		}}>
		X
	</VSCodeLink>
)

const DiscordLink = () => (
	<VSCodeLink
		href="https://discord.gg/rCQcvT7Fnt"
		onClick={(e) => {
			e.preventDefault()
			vscode.postMessage({ type: "openExternal", url: "https://discord.gg/rCQcvT7Fnt" })
		}}>
		Discord
	</VSCodeLink>
)

const RedditLink = () => (
	<VSCodeLink
		href="https://www.reddit.com/r/RooCode/"
		onClick={(e) => {
			e.preventDefault()
			vscode.postMessage({ type: "openExternal", url: "https://www.reddit.com/r/RooCode/" })
		}}>
		r/RooCode
	</VSCodeLink>
)

const CareersLink = ({ children }: { children?: React.ReactNode }) => (
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
