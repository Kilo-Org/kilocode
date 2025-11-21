// kilocode_change - simplified: Self-contained dialog that fetches changelog itself
import React, { useEffect, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog"
import MarkdownBlock from "../common/MarkdownBlock"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useReleaseNotes } from "../../hooks/useReleaseNotes"

interface ReleaseNotesDialogProps {
	isOpen: boolean
	onClose: () => void
	markdown?: string // Optional: if provided, use this instead of fetching
}

export const ReleaseNotesDialog: React.FC<ReleaseNotesDialogProps> = ({
	isOpen,
	onClose,
	markdown: providedMarkdown,
}) => {
	const { t } = useAppTranslation()
	const { markdown: fetchedMarkdown, loading, loadReleases } = useReleaseNotes()
	const hasLoadedRef = useRef(false)

	// Use provided markdown if available (Storybook), otherwise use fetched
	const markdown = providedMarkdown || fetchedMarkdown

	useEffect(() => {
		if (isOpen && !hasLoadedRef.current && !providedMarkdown) {
			hasLoadedRef.current = true
			loadReleases()
		}
		if (!isOpen) {
			hasLoadedRef.current = false
		}
	}, [isOpen, loadReleases, providedMarkdown])

	return (
		<Dialog open={isOpen} onOpenChange={onClose}>
			<DialogContent className="flex flex-col max-w-[calc(100%-3rem)] max-h-[50vh]">
				<DialogHeader>
					<DialogTitle className="text-xl font-medium text-vscode-editor-foreground">
						{t("kilocode:releaseNotes.modalTitle")}
					</DialogTitle>
				</DialogHeader>
				<div className="overflow-y-auto pr-2">
					{loading ? (
						<div className="text-center py-8 text-vscode-descriptionForeground">
							{t("kilocode:releaseNotes.loading")}
						</div>
					) : !markdown ? (
						<div className="text-center py-8 text-vscode-descriptionForeground">
							{t("kilocode:releaseNotes.noReleases")}
						</div>
					) : (
						<div className="release-notes-content">
							<MarkdownBlock markdown={markdown} />
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}
