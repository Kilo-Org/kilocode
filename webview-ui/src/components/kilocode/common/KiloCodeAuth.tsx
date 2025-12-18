import React, { useEffect, useState } from "react"
import { ButtonSecondary } from "./ButtonSecondary"
import { ButtonPrimary } from "./ButtonPrimary"
import Logo from "./Logo"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"
import DeviceAuthCard from "./DeviceAuthCard"

interface KiloCodeAuthProps {
	onManualConfigClick?: () => void
	onLoginClick?: () => void
	className?: string
}

type DeviceAuthStatus = "idle" | "initiating" | "pending" | "success" | "error" | "cancelled"

const KiloCodeAuth: React.FC<KiloCodeAuthProps> = ({ onManualConfigClick, onLoginClick, className = "" }) => {
	const { t } = useAppTranslation()
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
					setDeviceAuthStatus("success")
					setDeviceAuthUserEmail(message.deviceAuthUserEmail)

					// Save token to current profile
					vscode.postMessage({
						type: "deviceAuthCompleteWithProfile",
						text: "", // Empty string means use current profile
						values: {
							token: message.deviceAuthToken,
							userEmail: message.deviceAuthUserEmail,
						},
					})

					// Navigate to chat tab after 2 seconds
					setTimeout(() => {
						vscode.postMessage({
							type: "switchTab",
							tab: "chat",
						})
					}, 2000)
					break
				case "deviceAuthFailed":
					setDeviceAuthStatus("error")
					setDeviceAuthError(message.deviceAuthError)
					break
				case "deviceAuthCancelled":
					setDeviceAuthStatus("idle")
					setDeviceAuthCode(undefined)
					setDeviceAuthVerificationUrl(undefined)
					setDeviceAuthExpiresIn(undefined)
					setDeviceAuthTimeRemaining(undefined)
					setDeviceAuthError(undefined)
					break
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const handleStartDeviceAuth = () => {
		if (onLoginClick) {
			onLoginClick()
		} else {
			setDeviceAuthStatus("initiating")
			vscode.postMessage({ type: "startDeviceAuth" })
		}
	}

	const handleCancelDeviceAuth = () => {
		setDeviceAuthStatus("idle")
		setDeviceAuthCode(undefined)
		setDeviceAuthVerificationUrl(undefined)
		setDeviceAuthExpiresIn(undefined)
		setDeviceAuthTimeRemaining(undefined)
		setDeviceAuthError(undefined)
	}

	const handleRetryDeviceAuth = () => {
		setDeviceAuthStatus("idle")
		setDeviceAuthError(undefined)
		// Automatically start again
		setTimeout(() => handleStartDeviceAuth(), 100)
	}

	// Show device auth card if auth is in progress
	if (deviceAuthStatus !== "idle") {
		return (
			<div className={`flex flex-col items-center ${className}`}>
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
			</div>
		)
	}

	// Default welcome screen
	return (
		<div className={`flex flex-col items-center ${className}`}>
			<Logo />

			<h2 className="m-0 p-0 mb-4">{t("kilocode:welcome.greeting")}</h2>
			<p className="text-center mb-2">{t("kilocode:welcome.introText1")}</p>
			<p className="text-center mb-2">{t("kilocode:welcome.introText2")}</p>
			<p className="text-center mb-5">{t("kilocode:welcome.introText3")}</p>

			<div className="w-full flex flex-col gap-5">
				<ButtonPrimary onClick={handleStartDeviceAuth}>{t("kilocode:welcome.ctaButton")}</ButtonPrimary>

				{!!onManualConfigClick && (
					<ButtonSecondary onClick={() => onManualConfigClick && onManualConfigClick()}>
						{t("kilocode:welcome.manualModeButton")}
					</ButtonSecondary>
				)}
			</div>
		</div>
	)
}

export default KiloCodeAuth
