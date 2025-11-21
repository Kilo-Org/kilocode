// kilocode_change - simplified: Button that opens self-contained dialog
import React, { useState } from "react"
import { FileText, Bell } from "lucide-react"
import { Button } from "../ui"
import { ReleaseNotesDialog } from "./ReleaseNotesDialog"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface ShowReleaseNotesButtonProps {
	buttonText?: string
	className?: string
}

interface ShowReleaseNotesButtonInnerProps {
	buttonText: string
	className?: string
	showBadge: boolean
	onClick: () => void
}

export const ShowReleaseNotesButtonInner: React.FC<ShowReleaseNotesButtonInnerProps> = ({
	buttonText,
	className,
	showBadge,
	onClick,
}) => {
	return (
		<Button onClick={onClick} className={`relative ${className}`}>
			<FileText className="p-0.5" />
			{buttonText}
			{showBadge && (
				<div className="absolute -top-2 -right-2 size-4 bg-yellow-500 rounded-full flex items-center justify-center">
					<Bell size={24} fill="currentColor" className="p-0.5" />
				</div>
			)}
		</Button>
	)
}

export const ShowReleaseNotesButton: React.FC<ShowReleaseNotesButtonProps> = ({ buttonText, className = "w-40" }) => {
	const { t } = useAppTranslation()
	const [showDialog, setShowDialog] = useState(false)
	const displayText = buttonText || t("kilocode:releaseNotes.viewReleaseNotes")

	return (
		<>
			<ShowReleaseNotesButtonInner
				buttonText={displayText}
				className={className}
				showBadge={false}
				onClick={() => setShowDialog(true)}
			/>

			<ReleaseNotesDialog isOpen={showDialog} onClose={() => setShowDialog(false)} />
		</>
	)
}
