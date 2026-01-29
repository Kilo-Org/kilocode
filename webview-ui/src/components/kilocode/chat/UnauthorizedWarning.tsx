import { useEffect, useRef, useCallback } from "react"
import { ClineMessage } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { Button } from "@src/components/ui"
import { useTranslation } from "react-i18next"
import { safeJsonParse } from "@roo/safeJsonParse"

type UnauthorizedWarningProps = {
	message: ClineMessage
}

type UnauthorizedWarningData = {
	modelId?: string
}

export const UnauthorizedWarning = ({ message }: UnauthorizedWarningProps) => {
	const { t } = useTranslation()
	const hasRetried = useRef(false)

	const data = safeJsonParse<UnauthorizedWarningData>(message.text)

	const handleRetry = useCallback(() => {
		if (hasRetried.current) {
			return
		}
		hasRetried.current = true
		vscode.postMessage({
			type: "askResponse",
			askResponse: "retry_clicked",
			text: message.text,
		})
	}, [message.text])

	// Listen for successful authentication and automatically retry
	useEffect(() => {
		let retryTimeoutId: ReturnType<typeof setTimeout> | undefined

		const handleMessage = (event: MessageEvent) => {
			// Validate message shape and type before acting
			const msg = event.data
			if (typeof msg !== "object" || msg === null || msg.type !== "deviceAuthComplete") {
				return
			}
			// Auth succeeded - wait briefly for token to be saved, then retry
			retryTimeoutId = setTimeout(() => {
				handleRetry()
			}, 500)
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
			if (retryTimeoutId !== undefined) {
				clearTimeout(retryTimeoutId)
			}
		}
	}, [handleRetry])

	const modelId = data?.modelId || "(chosen)"

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<span className="text-yellow-400 text-lg">✨</span>
				<span className="font-semibold text-vscode-foreground">
					{t("kilocode:unauthorizedError.title", { modelId })}
				</span>
			</div>
			<p className="text-vscode-descriptionForeground text-sm m-0 break-words">
				{t("kilocode:unauthorizedError.message")}
			</p>
			<Button
				variant="primary"
				size="lg"
				className="w-full mt-1"
				onClick={() => {
					vscode.postMessage({
						type: "switchTab",
						tab: "auth",
						values: { returnTo: "chat" },
					})
				}}>
				{t("kilocode:unauthorizedError.loginButton")}
			</Button>
		</div>
	)
}
