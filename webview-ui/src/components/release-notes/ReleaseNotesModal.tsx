// kilocode_change - refactored: Modal component that accepts releases as props
import React, { useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog"
import { ReleaseNoteDisplay } from "./ReleaseNoteDisplay"
import { ReleaseNote } from "../../types/release-notes"

interface ReleaseNotesModalProps {
	isOpen: boolean
	onClose: () => void
	releases: ReleaseNote[]
	loading?: boolean
	currentVersion?: string
	onMarkAsViewed?: (version: string) => void
}

export const ReleaseNotesModal: React.FC<ReleaseNotesModalProps> = ({
	isOpen,
	onClose,
	releases,
	loading = false,
	currentVersion,
	onMarkAsViewed,
}) => {
	useEffect(() => {
		if (isOpen && currentVersion && onMarkAsViewed) {
			onMarkAsViewed(currentVersion)
		}
	}, [isOpen, currentVersion, onMarkAsViewed])

	return (
		<Dialog open={isOpen} onOpenChange={onClose}>
			<DialogContent className="flex flex-col max-w-[calc(100%-3rem)] max-h-[50vh]">
				<DialogHeader>
					<DialogTitle className="text-xl font-medium text-vscode-editor-foreground">
						What&apos;s New in Kilo Code
					</DialogTitle>
				</DialogHeader>
				<div className="overflow-y-auto pr-2">
					{loading ? (
						<div className="text-center py-8 text-vscode-descriptionForeground">
							Loading release notes...
						</div>
					) : releases.length === 0 ? (
						<div className="text-center py-8 text-vscode-descriptionForeground">
							No release notes available
						</div>
					) : (
						releases.map((release, index) => (
							<ReleaseNoteDisplay key={release.version} release={release} isLatest={index === 0} />
						))
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}
