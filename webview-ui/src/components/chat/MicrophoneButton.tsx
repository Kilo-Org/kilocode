// kilocode_change - new file: Microphone button component for speech-to-text recording
import React from "react"
import { Mic, Square } from "lucide-react"
import { useTranslation } from "react-i18next"
import { StandardTooltip } from "@/components/ui"
import { cn } from "@/lib/utils"

interface MicrophoneButtonProps {
	isRecording: boolean
	onClick: () => void
	containerWidth?: number
	disabled?: boolean
	tooltipContent?: string
}

export const MicrophoneButton: React.FC<MicrophoneButtonProps> = ({
	isRecording,
	onClick,
	containerWidth,
	disabled = false,
	tooltipContent,
}) => {
	const { t } = useTranslation()

	const defaultTooltip = isRecording
		? t("kilocode:speechToText.stopRecording")
		: t("kilocode:speechToText.startRecording")

	return (
		<StandardTooltip content={tooltipContent || defaultTooltip}>
			<button
				aria-label={
					isRecording ? t("kilocode:speechToText.stopRecording") : t("kilocode:speechToText.startRecording")
				}
				disabled={disabled}
				onClick={onClick}
				className={cn(
					"relative inline-flex items-center justify-center",
					"bg-transparent border-none p-1.5",
					"rounded-md min-w-[28px] min-h-[28px]",
					"transition-all duration-150",
					"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
					isRecording
						? "opacity-100 text-red-500 animate-pulse hover:text-red-600 cursor-pointer"
						: disabled
							? "opacity-40 cursor-not-allowed grayscale-[30%] hover:bg-transparent hover:border-[rgba(255,255,255,0.08)] active:bg-transparent text-vscode-descriptionForeground"
							: "opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)] active:bg-[rgba(255,255,255,0.1)] cursor-pointer",
					containerWidth !== undefined && { hidden: containerWidth < 235 },
				)}>
				{isRecording ? <Square className="w-4 h-4 fill-current" /> : <Mic className="w-4 h-4" />}
			</button>
		</StandardTooltip>
	)
}
