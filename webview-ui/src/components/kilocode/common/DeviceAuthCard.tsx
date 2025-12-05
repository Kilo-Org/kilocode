import React, { useEffect, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { generateQRCode } from "@/utils/kilocode/qrcode"
import { ButtonPrimary } from "./ButtonPrimary"
import { ButtonSecondary } from "./ButtonSecondary"
import { vscode } from "@/utils/vscode"
import Logo from "./Logo"

interface DeviceAuthCardProps {
	code?: string
	verificationUrl?: string
	expiresIn?: number
	timeRemaining?: number
	status: "idle" | "initiating" | "pending" | "success" | "error" | "cancelled"
	error?: string
	userEmail?: string
	onCancel?: () => void
	onRetry?: () => void
}

// Inner component for initiating state
const InitiatingState: React.FC = () => {
	const { t } = useAppTranslation()
	return (
		<div className="flex flex-col items-center gap-4 p-6 bg-vscode-sideBar-background rounded">
			<Logo />
			<div className="flex items-center gap-2">
				<span className="codicon codicon-loading codicon-modifier-spin text-xl"></span>
				<span className="text-vscode-foreground">{t("kilocode:deviceAuth.initiating")}</span>
			</div>
		</div>
	)
}

// Inner component for success state
interface SuccessStateProps {
	userEmail?: string
}

const SuccessState: React.FC<SuccessStateProps> = ({ userEmail }) => {
	const { t } = useAppTranslation()
	return (
		<div className="flex flex-col items-center gap-4 p-6 bg-vscode-sideBar-background rounded">
			<Logo />
			<h3 className="text-lg font-semibold text-vscode-foreground">{t("kilocode:deviceAuth.success")}</h3>
			{userEmail && (
				<p className="text-sm text-vscode-descriptionForeground">
					{t("kilocode:deviceAuth.authenticatedAs", { email: userEmail })}
				</p>
			)}
		</div>
	)
}

// Inner component for error state
interface ErrorStateProps {
	error?: string
	onRetry: () => void
}

const ErrorState: React.FC<ErrorStateProps> = ({ error, onRetry }) => {
	const { t } = useAppTranslation()
	return (
		<div className="flex flex-col items-center gap-4 p-6 bg-vscode-sideBar-background rounded">
			<Logo />
			<h3 className="text-lg font-semibold text-vscode-foreground">{t("kilocode:deviceAuth.error")}</h3>
			<p className="text-sm text-vscode-descriptionForeground text-center">
				{error || t("kilocode:deviceAuth.unknownError")}
			</p>
			<ButtonPrimary onClick={onRetry}>{t("kilocode:deviceAuth.retry")}</ButtonPrimary>
		</div>
	)
}

// Inner component for cancelled state
interface CancelledStateProps {
	onRetry: () => void
}

const CancelledState: React.FC<CancelledStateProps> = ({ onRetry }) => {
	const { t } = useAppTranslation()
	return (
		<div className="flex flex-col items-center gap-4 p-6 bg-vscode-sideBar-background rounded">
			<Logo />
			<h3 className="text-lg font-semibold text-vscode-foreground">{t("kilocode:deviceAuth.cancelled")}</h3>
			<ButtonPrimary onClick={onRetry}>{t("kilocode:deviceAuth.tryAgain")}</ButtonPrimary>
		</div>
	)
}

// Inner component for pending state
interface PendingStateProps {
	code: string
	verificationUrl: string
	qrCodeDataUrl: string
	timeRemaining?: number
	formatTime: (seconds?: number) => string
	onOpenBrowser: () => void
	onCancel: () => void
}

const PendingState: React.FC<PendingStateProps> = ({
	code,
	verificationUrl,
	qrCodeDataUrl,
	timeRemaining,
	formatTime,
	onOpenBrowser,
	onCancel,
}) => {
	const { t } = useAppTranslation()
	const handleCopyUrl = () => {
		navigator.clipboard.writeText(verificationUrl)
	}

	return (
		<div className="flex flex-col gap-2 bg-vscode-sideBar-background rounded">
			<h3 className="text-lg font-semibold text-vscode-foreground text-center">
				{t("kilocode:deviceAuth.title")}
			</h3>

			{/* Step 1: URL Section */}
			<div className="flex flex-col gap-3">
				<p className="text-sm text-vscode-descriptionForeground text-center">
					{t("kilocode:deviceAuth.step1")}
				</p>

				{/* URL Box with Copy and Open Browser */}
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2 p-3 bg-vscode-input-background border border-vscode-input-border rounded">
						<span className="flex-1 text-sm font-mono text-vscode-foreground truncate">
							{verificationUrl}
						</span>
						<button
							onClick={handleCopyUrl}
							className="flex-shrink-0 p-1 hover:bg-vscode-toolbar-hoverBackground rounded"
							title={t("kilocode:deviceAuth.copyUrl")}>
							<span className="codicon codicon-copy text-vscode-foreground"></span>
						</button>
					</div>
					<ButtonPrimary onClick={onOpenBrowser}>{t("kilocode:deviceAuth.openBrowser")}</ButtonPrimary>
				</div>

				{/* QR Code Section */}
				{qrCodeDataUrl && (
					<div className="flex flex-col items-center gap-2 mt-2">
						<p className="text-sm text-vscode-descriptionForeground">{t("kilocode:deviceAuth.scanQr")}</p>
						<img
							src={qrCodeDataUrl}
							alt="QR Code"
							className="w-40 h-40 border border-vscode-widget-border rounded"
						/>
					</div>
				)}
			</div>

			{/* Step 2: Verification Section */}
			<div className="flex flex-col gap-3">
				<p className="text-sm text-vscode-descriptionForeground text-center">
					{t("kilocode:deviceAuth.step2")}
				</p>

				{/* Verification Code */}
				<div className="flex justify-center">
					<div className="px-6 py-3 bg-vscode-input-background border-2 border-vscode-focusBorder rounded-lg">
						<span className="text-2xl font-mono font-bold text-vscode-foreground tracking-wider">
							{code}
						</span>
					</div>
				</div>

				{/* Time Remaining */}
				<div className="flex items-center justify-center gap-2">
					<span className="codicon codicon-clock text-vscode-descriptionForeground"></span>
					<span className="text-sm text-vscode-descriptionForeground">
						{t("kilocode:deviceAuth.timeRemaining", { time: formatTime(timeRemaining) })}
					</span>
				</div>

				{/* Status */}
				<div className="flex items-center justify-center gap-2">
					<span className="codicon codicon-loading codicon-modifier-spin text-vscode-descriptionForeground"></span>
					<span className="text-sm text-vscode-descriptionForeground">
						{t("kilocode:deviceAuth.waiting")}
					</span>
				</div>
			</div>

			{/* Cancel Button */}
			<div className="w-full flex flex-col">
				<ButtonSecondary onClick={onCancel}>{t("kilocode:deviceAuth.cancel")}</ButtonSecondary>
			</div>
		</div>
	)
}

const DeviceAuthCard: React.FC<DeviceAuthCardProps> = ({
	code,
	verificationUrl,
	timeRemaining,
	status,
	error,
	userEmail,
	onCancel,
	onRetry,
}) => {
	const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>("")

	// Generate QR code when verification URL is available
	useEffect(() => {
		if (verificationUrl) {
			generateQRCode(verificationUrl, {
				width: 200,
				margin: 2,
			})
				.then(setQrCodeDataUrl)
				.catch((err) => {
					console.error("Failed to generate QR code:", err)
				})
		}
	}, [verificationUrl])

	// Format time remaining as MM:SS
	const formatTime = (seconds?: number): string => {
		if (seconds === undefined) return "--:--"
		const mins = Math.floor(seconds / 60)
		const secs = seconds % 60
		return `${mins}:${secs.toString().padStart(2, "0")}`
	}

	const handleOpenBrowser = () => {
		if (verificationUrl) {
			vscode.postMessage({ type: "openExternal", url: verificationUrl })
		}
	}

	const handleCancel = () => {
		vscode.postMessage({ type: "cancelDeviceAuth" })
		onCancel?.()
	}
	const handleRetry = () => {
		onRetry?.()
	}

	// Render different states
	if (status === "initiating") {
		return <InitiatingState />
	}

	if (status === "success") {
		return <SuccessState userEmail={userEmail} />
	}

	if (status === "error") {
		return <ErrorState error={error} onRetry={handleRetry} />
	}

	if (status === "cancelled") {
		return <CancelledState onRetry={handleRetry} />
	}

	// Pending state - show code and QR
	if (status === "pending" && code && verificationUrl) {
		return (
			<PendingState
				code={code}
				verificationUrl={verificationUrl}
				qrCodeDataUrl={qrCodeDataUrl}
				timeRemaining={timeRemaining}
				formatTime={formatTime}
				onOpenBrowser={handleOpenBrowser}
				onCancel={handleCancel}
			/>
		)
	}

	// Idle state - shouldn't normally be shown
	return null
}

export default DeviceAuthCard
