// kilocode_change - new file: STT setup help popover
import React, { useCallback } from "react"
import { useTranslation, Trans } from "react-i18next"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui"
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"
import { buildDocLink } from "@/utils/docLinks"
import { vscode } from "@/utils/vscode"

interface STTSetupPopoverProps {
	children: React.ReactNode
	speechToTextStatus?: {
		available: boolean
		reason?: "openaiKeyMissing" | "ffmpegNotInstalled"
	}
	open: boolean
	onOpenChange: (open: boolean) => void
	setInputValue: (value: string) => void
	onSend: () => void
	error?: string | null
}

interface STTSetupPopoverContentProps {
	reason?: "openaiKeyMissing" | "ffmpegNotInstalled"
	setInputValue: (value: string) => void
	onSend: () => void
	onOpenChange?: (open: boolean) => void
	error?: string | null
}

export const STTSetupPopoverContent: React.FC<STTSetupPopoverContentProps> = ({
	reason,
	setInputValue,
	onSend,
	onOpenChange,
	error,
}) => {
	const { t } = useTranslation()
	const docsUrl = buildDocLink("features/experimental/voice-transcription", "stt_setup")

	const handleOpenAiHelpClick = () => {
		vscode.postMessage({ type: "openExternal", url: docsUrl })
		onOpenChange?.(false)
	}

	// kilocode_change: FFmpeg help - send message to chat
	const handleFfmpegHelpClick = useCallback(() => {
		const helpMessage = t("kilocode:speechToText.setupPopover.ffmpegMessage")
		setInputValue(helpMessage)

		setTimeout(() => {
			onSend()
		}) // Trigger send after a brief delay to ensure input is set
	}, [t, setInputValue, onSend])

	return (
		<div className="p-4 cursor-default">
			<h4 className="m-0 mb-3 text-base font-semibold">{t("kilocode:speechToText.setupPopover.title")}</h4>

			{error ? (
				// When there's an error, show just the error message
				<div
					className="my-0 mb-3 p-2 rounded text-sm border"
					style={{
						backgroundColor: "var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.1))",
						borderColor: "var(--vscode-inputValidation-errorBorder, #ff0000)",
						color: "var(--vscode-errorForeground, #ff0000)",
					}}>
					<strong>Error:</strong> {error}
				</div>
			) : (
				// When STT is not available, show setup instructions
				<>
					<p className="my-0 mb-3 text-sm text-vscode-descriptionForeground">
						<Trans
							i18nKey="kilocode:speechToText.setupPopover.description"
							components={{
								moreInfoLink: (
									<VSCodeLink
										href={docsUrl}
										onClick={(e) => {
											e.preventDefault()
											handleOpenAiHelpClick()
										}}
										className="inline"
									/>
								),
							}}
						/>
					</p>

					<ul className="my-0 mb-0 list-disc list-inside text-sm text-vscode-descriptionForeground space-y-1">
						{reason === "openaiKeyMissing" || !reason ? (
							<li>{t("kilocode:speechToText.setupPopover.openAiReason")}</li>
						) : null}
						{reason === "ffmpegNotInstalled" || !reason ? (
							<li>
								<Trans
									i18nKey="kilocode:speechToText.setupPopover.ffmpegReason"
									components={{
										ffmpegLink: (
											<VSCodeLink
												href="#"
												onClick={(e) => {
													e.preventDefault()
													handleFfmpegHelpClick()
													onOpenChange?.(false)
												}}
												className="inline"
											/>
										),
									}}
								/>
							</li>
						) : null}
					</ul>
				</>
			)}
		</div>
	)
}

export const STTSetupPopover: React.FC<STTSetupPopoverProps> = ({
	children,
	speechToTextStatus,
	open,
	onOpenChange,
	setInputValue,
	onSend,
	error,
}) => {
	const portalContainer = useRooPortal("roo-portal")

	// Show popover if STT is unavailable OR if there's an error
	const shouldShowPopover = !speechToTextStatus?.available || !!error
	if (!shouldShowPopover) {
		return <>{children}</>
	}

	const reason = speechToTextStatus?.reason

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger>{children}</PopoverTrigger>
			<PopoverContent
				className="w-[calc(100vw-32px)] max-w-[400px] p-0"
				align="end"
				alignOffset={0}
				side="bottom"
				sideOffset={5}
				collisionPadding={16}
				avoidCollisions={true}
				container={portalContainer}>
				<STTSetupPopoverContent
					reason={reason}
					setInputValue={setInputValue}
					onSend={onSend}
					onOpenChange={onOpenChange}
					error={error}
				/>
			</PopoverContent>
		</Popover>
	)
}
