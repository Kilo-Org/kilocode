// kilocode_change - new file: Button component that opens release notes modal manually
import React, { useState, useEffect } from "react"
import { FileText } from "lucide-react"
import { Button } from "../ui"
import { ReleaseNotesModal } from "./ReleaseNotesModal"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useReleaseNotes } from "../../hooks/useReleaseNotes"

interface ShowReleaseNotesButtonProps {
	buttonText?: string
	className?: string
}

export const ShowReleaseNotesButton: React.FC<ShowReleaseNotesButtonProps> = ({ buttonText, className = "w-40" }) => {
	const { t } = useAppTranslation()
	const [showModal, setShowModal] = useState(false)
	const { releases, loadReleases, loading, markAsViewed, currentVersion } = useReleaseNotes()
	const displayText = buttonText || t("kilocode:releaseNotes.viewReleaseNotes")

	useEffect(() => {
		if (showModal) {
			loadReleases()
		}
	}, [showModal, loadReleases])

	return (
		<>
			<Button onClick={() => setShowModal(true)} className={className}>
				<FileText className="p-0.5" />
				{displayText}
			</Button>

			{showModal && (
				<ReleaseNotesModal
					isOpen
					onClose={() => setShowModal(false)}
					releases={releases}
					loading={loading}
					currentVersion={currentVersion}
					onMarkAsViewed={markAsViewed}
				/>
			)}
		</>
	)
}
