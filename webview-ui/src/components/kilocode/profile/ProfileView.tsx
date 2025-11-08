import React, { useEffect } from "react"
import { vscode } from "@/utils/vscode"
import {
	BalanceDataResponsePayload,
	ProfileData,
	ProfileDataResponsePayload,
	WebviewMessage,
} from "@roo/WebviewMessage"
import { VSCodeButtonLink } from "@/components/common/VSCodeButtonLink"
import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react"
import CountUp from "react-countup"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Tab, TabContent, TabHeader } from "@src/components/common/Tab"
import { Button } from "@src/components/ui"
import KiloCodeAuth from "../common/KiloCodeAuth"
import { OrganizationSelector } from "../common/OrganizationSelector"
import { getAppUrl, TelemetryEventName } from "@roo-code/types"
import { telemetryClient } from "@/utils/TelemetryClient"

interface ProfileViewProps {
	onDone: () => void
}

const ProfileView: React.FC<ProfileViewProps> = ({ onDone }) => {
	const { apiConfiguration, currentApiConfigName, uriScheme, uiKind } = useExtensionState()
	const { t } = useAppTranslation()
	const [profileData, setProfileData] = React.useState<ProfileData | undefined | null>(null)
	const [balance, setBalance] = React.useState<number | null>(null)
	const [isLoadingBalance, setIsLoadingBalance] = React.useState(true)
	const [isLoadingUser, setIsLoadingUser] = React.useState(true)
	const organizationId = apiConfiguration?.kilocodeOrganizationId

	useEffect(() => {
		vscode.postMessage({ type: "fetchProfileDataRequest" })
		vscode.postMessage({ type: "fetchBalanceDataRequest" })
	}, [apiConfiguration?.kilocodeToken, organizationId])

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
			} else if (message.type === "updateProfileData") {
				vscode.postMessage({
					type: "fetchProfileDataRequest",
				})
				vscode.postMessage({
					type: "fetchBalanceDataRequest",
				})
			}
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [profileData])

	const user = profileData?.user

	function handleLogout(): void {
		console.info("Logging out...", apiConfiguration)
		vscode.postMessage({
			type: "upsertApiConfiguration",
			text: currentApiConfigName,
			apiConfiguration: {
				...apiConfiguration,
				kilocodeToken: "",
				kilocodeOrganizationId: undefined,
			},
		})
	}

	const creditPackages = [
		{
			credits: 20,
			popular: false,
		},
		{
			credits: 50,
			popular: true,
		},
		{
			credits: 100,
			popular: false,
		},
		{
			credits: 200,
			popular: false,
		},
	]

	const handleBuyCredits = (credits: number) => () => {
		vscode.postMessage({
			type: "shopBuyCredits",
			values: {
				credits: credits,
				uriScheme: uriScheme,
				uiKind: uiKind,
			},
		})
	}

	if (isLoadingUser) {
		return <></>
	}

	return (
		<Tab>
			<TabHeader className="flex justify-between items-center">
				<h3 className="text-vscode-foreground m-0">{t("kilocode:profile.title")}</h3>
				<Button onClick={onDone}>{t("settings:common.done")}</Button>
			</TabHeader>
			<TabContent>
				<div className="h-full flex flex-col">
					<div className="flex-1">
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

										<div className="flex flex-col flex-1">
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

									<OrganizationSelector className="mb-6" />
								</div>

								<div className="w-full flex gap-2 flex-col min-[225px]:flex-row">
									<div className="w-full min-[225px]:w-1/2">
										<VSCodeButtonLink
											href={getAppUrl("/profile")}
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

								<div className="w-full mt-2">
									{organizationId ? (
										<VSCodeButtonLink
											href={getAppUrl(`/organizations/${organizationId}/usage-details`)}
											appearance="secondary"
											className="w-full">
											{t("kilocode:profile.detailedUsage")}
										</VSCodeButtonLink>
									) : (
										(profileData.organizations?.length ?? 0) === 0 && (
											<VSCodeButtonLink
												onClick={() => {
													telemetryClient.capture(
														TelemetryEventName.CREATE_ORGANIZATION_LINK_CLICKED,
														{ origin: "usage-details" },
													)
												}}
												href={getAppUrl("/organizations/new")}
												appearance="primary"
												className="w-full">
												{t("kilocode:profile.createOrganization")}
											</VSCodeButtonLink>
										)
									)}
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

									{/* Buy Credits Section - Only show for personal accounts */}
									{!organizationId && (
										<div className="w-full mt-8">
											<div className="text-lg font-semibold text-[var(--vscode-foreground)] mb-4 text-center">
												{t("kilocode:profile.shop.title")}
											</div>

											<div className="grid grid-cols-1 min-[300px]:grid-cols-2 gap-3 mb-6">
												{creditPackages.map((pkg) => (
													<div
														key={pkg.credits}
														className={`relative border rounded-lg p-4 bg-[var(--vscode-editor-background)] transition-all hover:shadow-md ${
															pkg.popular
																? "border-[var(--vscode-button-background)] ring-1 ring-[var(--vscode-button-background)]"
																: "border-[var(--vscode-input-border)]"
														}`}>
														{pkg.popular && (
															<div className="absolute -top-2 left-1/2 transform -translate-x-1/2">
																<span className="bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] text-xs px-2 py-1 rounded-full font-medium">
																	{t("kilocode:profile.shop.popular")}
																</span>
															</div>
														)}

														<div className="text-center">
															<div className="text-2xl font-bold text-[var(--vscode-foreground)] mb-1">
																${pkg.credits}
															</div>
															<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-2">
																{t("kilocode:profile.shop.credits")}
															</div>
															<VSCodeButton
																appearance={pkg.popular ? "primary" : "secondary"}
																className="w-full"
																onClick={handleBuyCredits(pkg.credits)}>
																{t("kilocode:profile.shop.action")}
															</VSCodeButton>
														</div>
													</div>
												))}
											</div>

											<div className="text-center">
												<VSCodeButtonLink
													href={getAppUrl("/profile")}
													appearance="secondary"
													className="text-sm">
													{t("kilocode:profile.shop.viewAll")}
												</VSCodeButtonLink>
											</div>
										</div>
									)}
								</div>
							</div>
						) : (
							<div className="flex flex-col items-center pr-3">
								<KiloCodeAuth className="w-full" />
							</div>
						)}
					</div>
				</div>
			</TabContent>
		</Tab>
	)
}

export default ProfileView
