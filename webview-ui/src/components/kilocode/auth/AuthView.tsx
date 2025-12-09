import { useEffect, useState } from "react"
import { vscode } from "@/utils/vscode"
import { Tab, TabContent } from "../../common/Tab"
import DeviceAuthCard from "../common/DeviceAuthCard"

interface AuthViewProps {
	returnTo?: "chat" | "settings"
	profileName?: string
}

type DeviceAuthStatus = "idle" | "initiating" | "pending" | "success" | "error" | "cancelled"

const AuthView: React.FC<AuthViewProps> = ({ returnTo = "chat", profileName }) => {
	const [deviceAuthStatus, setDeviceAuthStatus] = useState<DeviceAuthStatus>("idle")
	const [deviceAuthCode, setDeviceAuthCode] = useState<string>()
	const [deviceAuthVerificationUrl, setDeviceAuthVerificationUrl] = useState<string>()
	const [deviceAuthExpiresIn, setDeviceAuthExpiresIn] = useState<number>()
	const [deviceAuthTimeRemaining, setDeviceAuthTimeRemaining] = useState<number>()
	const [deviceAuthError, setDeviceAuthError] = useState<string>()
	const [deviceAuthUserEmail, setDeviceAuthUserEmail] = useState<string>()

	// Listen for device auth messages from extension
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			switch (message.type) {
				case "deviceAuthStarted":
					setDeviceAuthStatus("pending")
					setDeviceAuthCode(message.deviceAuthCode)
					setDeviceAuthVerificationUrl(message.deviceAuthVerificationUrl)
					setDeviceAuthExpiresIn(message.deviceAuthExpiresIn)
					setDeviceAuthTimeRemaining(message.deviceAuthExpiresIn)
					setDeviceAuthError(undefined)
					break
				case "deviceAuthPolling":
					setDeviceAuthTimeRemaining(message.deviceAuthTimeRemaining)
					break
				case "deviceAuthComplete":
					console.log("[AuthView] Device auth complete received", {
						profileName,
						token: message.deviceAuthToken ? "present" : "missing",
						userEmail: message.deviceAuthUserEmail,
					})
					setDeviceAuthStatus("success")
					setDeviceAuthUserEmail(message.deviceAuthUserEmail)

					// Always send profile-specific message to prevent double-save
					// If no profileName, backend will use current profile
					console.log(
						"[AuthView] Sending deviceAuthCompleteWithProfile to profile:",
						profileName || "current",
					)
					vscode.postMessage({
						type: "deviceAuthCompleteWithProfile",
						text: profileName || "", // Empty string means use current profile
						values: {
							token: message.deviceAuthToken,
							userEmail: message.deviceAuthUserEmail,
						},
					})

					// Navigate back after 2 seconds
					setTimeout(() => {
						vscode.postMessage({
							type: "switchTab",
							tab: returnTo,
							values: profileName ? { editingProfile: profileName } : undefined,
						})
					}, 2000)
					break
				case "deviceAuthFailed":
					setDeviceAuthStatus("error")
					setDeviceAuthError(message.deviceAuthError)
					break
				case "deviceAuthCancelled":
					// Navigate back immediately on cancel
					vscode.postMessage({
						type: "switchTab",
						tab: returnTo,
						values: profileName ? { editingProfile: profileName } : undefined,
					})
					break
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [returnTo, profileName])

	// Auto-start device auth when component mounts
	useEffect(() => {
		setDeviceAuthStatus("initiating")
		vscode.postMessage({ type: "startDeviceAuth" })
	}, [])

	const handleCancelDeviceAuth = () => {
		// Navigation will be handled by deviceAuthCancelled message
	}

	const handleRetryDeviceAuth = () => {
		setDeviceAuthStatus("idle")
		setDeviceAuthError(undefined)
		// Automatically start again
		setTimeout(() => {
			setDeviceAuthStatus("initiating")
			vscode.postMessage({ type: "startDeviceAuth" })
		}, 100)
	}

	return (
		<Tab>
			<TabContent className="flex flex-col items-center justify-center min-h-screen p-6">
				<DeviceAuthCard
					code={deviceAuthCode}
					verificationUrl={deviceAuthVerificationUrl}
					expiresIn={deviceAuthExpiresIn}
					timeRemaining={deviceAuthTimeRemaining}
					status={deviceAuthStatus}
					error={deviceAuthError}
					userEmail={deviceAuthUserEmail}
					onCancel={handleCancelDeviceAuth}
					onRetry={handleRetryDeviceAuth}
				/>
			</TabContent>
		</Tab>
	)
}

export default AuthView
