// import { useExtensionState } from "@/context/ExtensionStateContext" // No longer needed
import React, { useEffect } from "react"
import { Trans } from "react-i18next"
import { vscode } from "@/utils/vscode"
import {
	BalanceDataResponsePayload,
	ProfileData,
	ProfileDataResponsePayload,
	WebviewMessage,
} from "@roo/shared/WebviewMessage"
import { VSCodeButtonLink } from "@/components/common/VSCodeButtonLink"
import { VSCodeButton, VSCodeDivider, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import CountUp from "react-countup"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { getKiloCodeBackendAuthUrl } from "../helpers"
import Logo from "../common/Logo"

interface ProfileViewProps {
	onDone: () => void
}

const ProfileView: React.FC<ProfileViewProps> = ({ onDone: _onDone }) => {
	const { apiConfiguration, currentApiConfigName, uriScheme } = useExtensionState()
	const { t } = useAppTranslation()
	const [profileData, setProfileData] = React.useState<ProfileData | undefined | null>(null)
	const [balance, setBalance] = React.useState<number | null>(null)
	const [isLoadingBalance, setIsLoadingBalance] = React.useState(true)
	const [isLoadingUser, setIsLoadingUser] = React.useState(true)

	useEffect(() => {
		vscode.postMessage({
			type: "fetchProfileDataRequest",
		})
		vscode.postMessage({
			type: "fetchBalanceDataRequest",
		})
	}, [apiConfiguration?.kilocodeToken])

	useEffect(() => {
		const handleMessage = (event: MessageEvent<WebviewMessage>) => {
			const message = event.data
			if (message.type === "profileDataResponse") {
				const payload = message.payload as ProfileDataResponsePayload
				if (payload.success) {
					setProfileData(payload.data)
				} else {
					console.error("Error fetching profile data:", payload.error)
					setProfileData(null)
				}
				setIsLoadingUser(false)
			} else if (message.type === "balanceDataResponse") {
				const payload = message.payload as BalanceDataResponsePayload
				if (payload.success) {
					setBalance(payload.data?.balance || 0)
				} else {
					console.error("Error fetching balance data:", payload.error)
					setBalance(null)
				}
				setIsLoadingBalance(false)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	const user = profileData?.user

	function handleLogout(): void {
		console.info("Logging out...", apiConfiguration)
		vscode.postMessage({
			type: "upsertApiConfiguration",
			text: currentApiConfigName,
			apiConfiguration: {
				...apiConfiguration,
				kilocodeToken: "",
			},
		})
	}

	if (isLoadingUser) {
		return <></>
	}

	return (
		<div className="h-full flex flex-col">
			{user ? (
				<div className="flex flex-col pr-3 h-full">
					<div className="flex flex-col w-full">
						<div className="flex items-center mb-6 flex-wrap gap-y-4">
							{user.image ? (
								<img src={user.image} alt="Profile" className="size-16 rounded-full mr-4" />
							) : (
								<div className="size-16 rounded-full bg-[var(--vscode-button-background)] flex items-center justify-center text-2xl text-[var(--vscode-button-foreground)] mr-4">
									{user.name?.[0] || user.email?.[0] || "?"}
								</div>
							)}

							<div className="flex flex-col">
								{user.name && (
									<h2 className="text-[var(--vscode-foreground)] m-0 mb-1 text-lg font-medium">
										{user.name}
									</h2>
								)}

								{user.email && (
									<div className="text-sm text-[var(--vscode-descriptionForeground)]">
										{user.email}
									</div>
								)}
							</div>
						</div>
					</div>

					<div className="w-full flex gap-2 flex-col min-[225px]:flex-row">
						<div className="w-full min-[225px]:w-1/2">
							<VSCodeButtonLink
								href="https://kilocode.ai/profile"
								appearance="primary"
								className="w-full">
								{t("kilocode:profile.dashboard")}
							</VSCodeButtonLink>
						</div>
						<VSCodeButton
							appearance="secondary"
							onClick={handleLogout}
							className="w-full min-[225px]:w-1/2">
							{t("kilocode:profile.logOut")}
						</VSCodeButton>
					</div>

					<VSCodeDivider className="w-full my-6" />

					<div className="w-full flex flex-col items-center">
						<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-3">
							{t("kilocode:profile.currentBalance")}
						</div>

						<div className="text-4xl font-bold text-[var(--vscode-foreground)] mb-6 flex items-center gap-2">
							{isLoadingBalance ? (
								<div className="text-[var(--vscode-descriptionForeground)]">
									{t("kilocode:profile.loading")}
								</div>
							) : (
								balance && (
									<>
										<span>$</span>
										<CountUp end={balance} duration={0.66} decimals={2} />
										<VSCodeButton
											appearance="icon"
											className="mt-1"
											onClick={() => {
												setIsLoadingBalance(true)

												vscode.postMessage({ type: "fetchBalanceDataRequest" })
											}}>
											<span className="codicon codicon-refresh"></span>
										</VSCodeButton>
									</>
								)
							)}
						</div>
					</div>
				</div>
			) : (
				<div className="flex flex-col items-center pr-3">
					<Logo />

					<p className="text-center">{t("kilocode:profile.signUp.description")}</p>

					<VSCodeButtonLink href={getKiloCodeBackendAuthUrl(uriScheme)} className="w-full mb-4">
						{t("kilocode:profile.signUp.title")}
					</VSCodeButtonLink>

					<p className="text-[var(--vscode-descriptionForeground)] text-xs text-center m-0">
						<Trans
							i18nKey="kilocode:profile.signUp.termsAndPrivacy"
							components={{
								termsLink: <VSCodeLink href="https://kilocode.ai/terms" />,
								privacyLink: <VSCodeLink href="https://kilocode.ai/privacy" />,
							}}
						/>
					</p>
				</div>
			)}
		</div>
	)
}

export default ProfileView
