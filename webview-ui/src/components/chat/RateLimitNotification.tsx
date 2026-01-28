// kilocode_change - new file
import { useEffect, useState } from "react"
import { Clock } from "lucide-react"
import { ClineMessage } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { RetryIconButton } from "../kilocode/common/RetryIconButton"
import styled from "styled-components"

interface RateLimitNotificationProps {
	message: ClineMessage
}

type RateLimitData = {
	title: string
	message: string
	resetTime: number
}

const HeaderContainer = styled.div`
	display: flex;
	align-items: center;
	gap: 10px;
	margin-bottom: 10px;
`

const Description = styled.div`
	margin: 0;
	white-space: pre-wrap;
	word-break: break-word;
	overflow-wrap: anywhere;
`

export const RateLimitNotification = ({ message }: RateLimitNotificationProps) => {
	const [timeRemaining, setTimeRemaining] = useState("")

	let data: RateLimitData = {
		title: "Rate Limit Reached",
		message: "You've reached the rate limit. Please wait or create an account.",
		resetTime: Date.now() + 60 * 60 * 1000,
	}

	try {
		data = JSON.parse(message.text ?? "{}")
	} catch (e) {
		console.error("Failed to parse rate_limit_reached data:", e)
	}

	useEffect(() => {
		const updateTime = () => {
			const remaining = Math.max(0, data.resetTime - Date.now())
			const minutes = Math.floor(remaining / 60000)
			setTimeRemaining(`Please wait ${minutes} minute${minutes !== 1 ? "s" : ""} before trying again.`)
		}

		updateTime()
		const interval = setInterval(updateTime, 60000) // Update every minute

		return () => clearInterval(interval)
	}, [data.resetTime])

	const handleRetry = () => {
		vscode.postMessage({
			type: "askResponse",
			askResponse: "retry_clicked",
			text: message.text,
		})
	}

	const handleCreateAccount = () => {
		vscode.postMessage({
			type: "rooCloudSignIn",
			useProviderSignup: true,
		})
	}

	return (
		<>
			<HeaderContainer>
				<Clock className="size-5 text-vscode-notificationsWarningIcon-foreground shrink-0" />
				<span style={{ fontWeight: "bold" }}>{data.title}</span>
			</HeaderContainer>
			<Description>{data.message}</Description>

			<div
				className="bg-vscode-panel-border flex flex-col gap-3"
				style={{
					borderRadius: "4px",
					display: "flex",
					marginTop: "15px",
					padding: "14px 16px 22px",
					justifyContent: "center",
				}}>
				<div className="flex justify-between items-center">
					{timeRemaining}
					<RetryIconButton onClick={handleRetry} />
				</div>
				<VSCodeButton className="p-1 w-full rounded" appearance="primary" onClick={handleCreateAccount}>
					Create Account for Unlimited Access
				</VSCodeButton>
			</div>
		</>
	)
}
