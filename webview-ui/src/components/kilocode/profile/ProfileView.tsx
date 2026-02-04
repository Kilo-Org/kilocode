import React, { useEffect, useMemo } from "react"
import { vscode } from "@/utils/vscode"
import {
	BalanceDataResponsePayload,
	KiloPassStateResponsePayload,
	KiloPassSubscriptionState,
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

	// Detect VS Code light theme (VS Code uses vscode-light/vscode-dark classes on body)
	const isLightTheme = useMemo(() => {
		if (typeof document === "undefined") return false
		const cls = document.body.className
		return /\bvscode-light\b|\bvscode-high-contrast-light\b/i.test(cls)
	}, [])
	const [profileData, setProfileData] = React.useState<ProfileData | undefined | null>(null)
	const [balance, setBalance] = React.useState<number | null>(null)
	const [isLoadingBalance, setIsLoadingBalance] = React.useState(true)
	const [isLoadingUser, setIsLoadingUser] = React.useState(true)
	const [kiloPassState, setKiloPassState] = React.useState<KiloPassSubscriptionState | null>(null)
	const [isLoadingKiloPass, setIsLoadingKiloPass] = React.useState(true)
	const organizationId = apiConfiguration?.kilocodeOrganizationId

	useEffect(() => {
		vscode.postMessage({ type: "fetchProfileDataRequest" })
		vscode.postMessage({ type: "fetchBalanceDataRequest" })
		vscode.postMessage({ type: "fetchKiloPassStateRequest" })
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
					// `BalanceDataResponsePayload.data` is `unknown` (from backend). Normalize defensively.
					setBalance(((payload.data as any)?.balance as number) || 0) // kilocode_change
				} else {
					console.error("Error fetching balance data:", payload.error)
					setBalance(null)
				}
				setIsLoadingBalance(false)
			} else if (message.type === "kiloPassStateResponse") {
				const payload = message.payload as KiloPassStateResponsePayload
				if (payload.success) {
					setKiloPassState(payload.data?.subscription || null)
				} else {
					console.error("Error fetching Kilo Pass state:", payload.error)
					setKiloPassState(null)
				}
				setIsLoadingKiloPass(false)
			} else if (message.type === "updateProfileData") {
				vscode.postMessage({
					type: "fetchProfileDataRequest",
				})
				vscode.postMessage({
					type: "fetchBalanceDataRequest",
				})
				vscode.postMessage({
					type: "fetchKiloPassStateRequest",
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

	const subscriptionPlans = [
		{
			name: "Starter",
			price: 19,
			boostBonus: 9.5,
			recommended: false,
		},
		{
			name: "Pro",
			price: 49,
			boostBonus: 24.5,
			recommended: true,
		},
		{
			name: "Expert",
			price: 199,
			boostBonus: 99.5,
			recommended: false,
		},
	]

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

	const handleGetKiloPass = () => {
		vscode.postMessage({
			type: "openExternal",
			url: getAppUrl("/profile"),
		})
	}

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

									{/* Kilo Pass & Credits Section - Only show for personal accounts */}
									{!organizationId && (
										<div className="w-full mt-8">
											{/* Kilo Pass Section */}
											{isLoadingKiloPass ? (
												<div className="text-center text-[var(--vscode-descriptionForeground)] mb-6">
													{t("kilocode:profile.loading")}
												</div>
											) : kiloPassState ? (
												/* Show current subscription info - new design */
												<div className="mb-6">
													{/* Main subscription card */}
													<div className="border rounded-lg p-3 bg-[var(--vscode-editor-background)] border-[var(--vscode-widget-border)]">
														{/* Header with icon, tier info, and status */}
														<div className="flex items-center justify-between mb-3">
															<div className="flex items-center gap-3">
																<div className="size-10 rounded-full bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] flex items-center justify-center">
																	<span className="codicon codicon-history text-[var(--vscode-foreground)]"></span>
																</div>
																<div>
																	<div className="font-semibold text-[var(--vscode-foreground)]">
																		{t("kilocode:profile.kiloPass.title")}
																	</div>
																	<div className="text-sm text-[var(--vscode-descriptionForeground)]">
																		{t(
																			`kilocode:profile.kiloPass.tiers.${kiloPassState.tier}`,
																		)}{" "}
																		•{" "}
																		{t(
																			`kilocode:profile.kiloPass.cadence.${kiloPassState.cadence}`,
																		)}
																	</div>
																</div>
															</div>
															<span
																className={`text-xs px-3 py-1 rounded-full font-medium border ${
																	kiloPassState.cancelAtPeriodEnd
																		? isLightTheme
																			? "border-amber-600 text-amber-600"
																			: "border-yellow-600 text-yellow-500"
																		: kiloPassState.status === "active"
																			? "border-[var(--vscode-widget-border)] text-[var(--vscode-foreground)]"
																			: kiloPassState.status === "canceled"
																				? isLightTheme
																					? "border-amber-600 text-amber-600"
																					: "border-yellow-600 text-yellow-500"
																				: "border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]"
																}`}>
																{kiloPassState.cancelAtPeriodEnd
																	? t("kilocode:profile.kiloPass.status.cancelling")
																	: t(
																			`kilocode:profile.kiloPass.status.${kiloPassState.status}`,
																		)}
															</span>
														</div>

														{/* Boost Mode Section - always rendered since data comes from backend */}
														{(() => {
															const usageUsd = kiloPassState.currentPeriodUsageUsd
															const totalUsd = kiloPassState.currentPeriodBaseCreditsUsd
															const isBonusUnlocked = kiloPassState.isBonusUnlocked
															const bonusCreditsUsd =
																kiloPassState.currentPeriodBonusCreditsUsd
															const remainingToUnlock = totalUsd - usageUsd

															return (
																<>
																	{/* Boost Mode Bar (when unlocked) or Monthly Usage Progress (when not unlocked) */}
																	{isBonusUnlocked ? (
																		<div
																			className={`mb-2 relative rounded-lg border overflow-hidden py-2 px-4 flex items-center justify-center gap-2 ${
																				isLightTheme
																					? "border-teal-500 bg-gradient-to-r from-teal-50 via-violet-50 to-teal-50"
																					: "border-[var(--vscode-widget-border)] bg-gradient-to-r from-emerald-500/10 via-violet-500/10 to-emerald-500/10"
																			}`}>
																			{/* Animated gradient background */}
																			<div
																				className={`pointer-events-none absolute -inset-1/2 opacity-60 blur-2xl animate-[spin_18s_linear_infinite] ${
																					isLightTheme
																						? ""
																						: "mix-blend-screen"
																				}`}
																				style={{
																					background:
																						"conic-gradient(from 90deg at 50% 50%, rgba(16,185,129,0.22), rgba(168,85,247,0.22), rgba(16,185,129,0.22))",
																				}}
																			/>
																			<span className="relative flex items-center justify-center size-4">
																				<span className="absolute inset-0 rounded-full bg-teal-400/30 opacity-60 animate-ping" />
																				<span
																					className={`codicon codicon-zap relative animate-pulse ${
																						isLightTheme
																							? "text-teal-600"
																							: "text-emerald-400"
																					}`}></span>
																			</span>
																			{isLightTheme ? (
																				<span className="relative font-bold text-sm text-teal-700">
																					{t(
																						"kilocode:profile.kiloPass.boost.mode",
																					)}
																				</span>
																			) : (
																				<span className="relative font-bold text-sm bg-gradient-to-r from-emerald-400 via-violet-300 to-emerald-400 bg-clip-text text-transparent">
																					{t(
																						"kilocode:profile.kiloPass.boost.mode",
																					)}
																				</span>
																			)}
																		</div>
																	) : (
																		<div className="mb-2">
																			<div className="flex justify-between items-center mb-1">
																				<span className="text-sm text-[var(--vscode-foreground)]">
																					{t(
																						"kilocode:profile.kiloPass.boost.monthlyUsage",
																					)}
																				</span>
																				<span
																					className={`text-sm ${isLightTheme ? "text-orange-600 font-medium" : "text-yellow-500 font-medium"}`}>
																					${usageUsd.toFixed(2)} / $
																					{totalUsd.toFixed(2)}
																				</span>
																			</div>
																			<div className="h-2 bg-[var(--vscode-editor-background)] rounded-full overflow-hidden border border-[var(--vscode-widget-border)]">
																				<div
																					className={`h-full rounded-full transition-all duration-300 ${isLightTheme ? "bg-orange-500" : "bg-yellow-500"}`}
																					style={{
																						width: `${Math.min((usageUsd / totalUsd) * 100, 100)}%`,
																					}}
																				/>
																			</div>
																		</div>
																	)}

																	{/* Boost Status Card */}
																	<div
																		className={`rounded-lg p-2.5 mb-2 border ${
																			isBonusUnlocked
																				? isLightTheme
																					? "bg-teal-50 border-teal-500"
																					: "bg-emerald-950/30 border-emerald-700"
																				: isLightTheme
																					? "bg-teal-50/30 border-teal-400 border-dashed"
																					: "bg-emerald-950/20 border-emerald-800/50 border-dashed"
																		}`}>
																		<div className="flex items-center justify-between">
																			<div className="flex items-center gap-2">
																				<div
																					className={`size-8 rounded-lg flex items-center justify-center ${
																						isBonusUnlocked
																							? isLightTheme
																								? "bg-teal-600"
																								: "bg-emerald-600"
																							: isLightTheme
																								? "bg-teal-100"
																								: "bg-emerald-900/50"
																					}`}>
																					{isBonusUnlocked ? (
																						<span className="codicon codicon-zap text-white"></span>
																					) : (
																						<span
																							className={`codicon codicon-lock ${isLightTheme ? "text-teal-600" : "text-emerald-500"}`}></span>
																					)}
																				</div>
																				<span className="text-[var(--vscode-foreground)] text-sm">
																					{isBonusUnlocked ? (
																						t(
																							"kilocode:profile.kiloPass.boost.unlocked",
																						)
																					) : (
																						<>
																							Use{" "}
																							<span
																								className={
																									isLightTheme
																										? "text-teal-600 font-medium"
																										: "text-emerald-400 font-medium"
																								}>
																								$
																								{remainingToUnlock.toFixed(
																									2,
																								)}
																							</span>{" "}
																							to unlock Boost
																						</>
																					)}
																				</span>
																			</div>
																			{/* Show usage/total + bonus when unlocked, just bonus when not */}
																			{isBonusUnlocked ? (
																				<div className="flex items-center gap-2">
																					<span
																						className={
																							isLightTheme
																								? "text-orange-600 font-medium"
																								: "text-yellow-500 font-medium"
																						}>
																						${totalUsd.toFixed(2)} / $
																						{totalUsd.toFixed(2)}
																					</span>
																					{bonusCreditsUsd != null && (
																						<span className="text-[var(--vscode-descriptionForeground)] font-medium">
																							+$
																							{bonusCreditsUsd.toFixed(2)}
																						</span>
																					)}
																				</div>
																			) : (
																				bonusCreditsUsd != null && (
																					<span className="text-[var(--vscode-descriptionForeground)] font-mono font-medium">
																						${bonusCreditsUsd.toFixed(2)}
																					</span>
																				)
																			)}
																		</div>
																	</div>
																</>
															)
														})()}

														{/* Streak and Next Boost */}
														{kiloPassState.currentStreakMonths > 0 && (
															<div className="flex items-center justify-between py-2 border-t border-[var(--vscode-widget-border)]">
																<div className="flex items-center gap-2">
																	<span>🔥</span>
																	<span className="text-[var(--vscode-foreground)] font-medium">
																		{kiloPassState.currentStreakMonths === 1
																			? t("kilocode:profile.kiloPass.streak", {
																					count: kiloPassState.currentStreakMonths,
																				})
																			: t(
																					"kilocode:profile.kiloPass.streakPlural",
																					{
																						count: kiloPassState.currentStreakMonths,
																					},
																				)}
																	</span>
																</div>
																{!kiloPassState.cancelAtPeriodEnd &&
																	kiloPassState.nextBonusCreditsUsd && (
																		<div className="flex items-center gap-1 text-sm">
																			<span className="text-[var(--vscode-descriptionForeground)]">
																				{t(
																					"kilocode:profile.kiloPass.boost.nextBoost",
																				)}
																			</span>
																			<span
																				className={
																					isLightTheme
																						? "text-orange-600 font-medium"
																						: "text-yellow-500 font-medium"
																				}>
																				$
																				{kiloPassState.nextBonusCreditsUsd.toFixed(
																					2,
																				)}
																			</span>
																		</div>
																	)}
															</div>
														)}

														{/* Refill Date / Pass active until */}
														{kiloPassState.nextBillingAt && (
															<div className="flex items-center justify-between py-2 border-t border-[var(--vscode-widget-border)]">
																<div className="flex items-center gap-2">
																	<span className="codicon codicon-sync text-[var(--vscode-descriptionForeground)]"></span>
																	<span className="text-[var(--vscode-descriptionForeground)]">
																		{kiloPassState.cancelAtPeriodEnd
																			? t(
																					"kilocode:profile.kiloPass.passActiveUntil",
																				)
																			: (() => {
																					const refillDate = new Date(
																						kiloPassState.nextBillingAt!,
																					)
																					const now = new Date()
																					const diffTime =
																						refillDate.getTime() -
																						now.getTime()
																					const diffDays = Math.ceil(
																						diffTime /
																							(1000 * 60 * 60 * 24),
																					)
																					return t(
																						"kilocode:profile.kiloPass.refills",
																						{ days: diffDays },
																					)
																				})()}
																	</span>
																</div>
																<span className="text-[var(--vscode-foreground)]">
																	{new Date(
																		kiloPassState.nextBillingAt,
																	).toLocaleDateString("en-US", {
																		month: "short",
																		day: "numeric",
																		year: "numeric",
																	})}
																</span>
															</div>
														)}

														{/* Credits Note */}
														<div className="mt-2 pt-2 border-t border-[var(--vscode-widget-border)]">
															<p className="text-xs text-[var(--vscode-descriptionForeground)]">
																{t("kilocode:profile.kiloPass.creditsNote")}
															</p>
														</div>

														{/* Manage Subscription Button */}
														<div className="mt-2">
															<VSCodeButtonLink
																href={getAppUrl("/profile")}
																appearance="secondary"
																className="w-full">
																<span className="codicon codicon-link-external mr-2"></span>
																{t("kilocode:profile.kiloPass.manage")}
															</VSCodeButtonLink>
														</div>
													</div>
												</div>
											) : (
												/* Show subscription options */
												<>
													<div className="text-xl font-semibold text-[var(--vscode-foreground)] mb-1 text-center">
														{t("kilocode:profile.kiloPass.title")}
													</div>
													<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-4 text-center">
														Unlock{" "}
														<span
															className={
																isLightTheme
																	? "text-teal-600 font-medium"
																	: "text-emerald-400 font-medium"
															}>
															Boost Mode
														</span>{" "}
														for up to 50% free credits.
													</div>

													<div className="grid grid-cols-1 min-[300px]:grid-cols-3 gap-3 mb-4">
														{subscriptionPlans.map((plan) => (
															<div
																key={plan.name}
																className={`relative border rounded-lg p-3 bg-[var(--vscode-editor-background)] transition-all hover:shadow-md ${
																	plan.recommended
																		? "border-[var(--vscode-button-background)] ring-1 ring-[var(--vscode-button-background)]"
																		: "border-[var(--vscode-input-border)]"
																}`}>
																{plan.recommended && (
																	<div className="absolute -top-2 left-1/2 transform -translate-x-1/2">
																		<span className="bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] text-xs px-2 py-0.5 rounded-full font-medium">
																			{t("kilocode:profile.kiloPass.recommended")}
																		</span>
																	</div>
																)}

																{/* Header: Plan name + Monthly */}
																<div className="flex justify-between items-center mb-2">
																	<span className="font-semibold text-[var(--vscode-foreground)]">
																		{plan.name}
																	</span>
																	<span className="text-xs text-[var(--vscode-descriptionForeground)]">
																		Monthly
																	</span>
																</div>

																{/* Price */}
																<div className="text-2xl font-bold text-[var(--vscode-foreground)] mb-3">
																	${plan.price}
																	<span className="text-sm font-normal text-[var(--vscode-descriptionForeground)]">
																		/month
																	</span>
																</div>

																{/* Details */}
																<div className="space-y-1 text-xs mb-3">
																	<div className="text-[var(--vscode-descriptionForeground)]">
																		Includes{" "}
																		<span
																			className={
																				isLightTheme
																					? "text-orange-600 font-medium"
																					: "text-yellow-500 font-medium"
																			}>
																			${plan.price}/month
																		</span>{" "}
																		pass credits
																	</div>
																	<div className="text-[var(--vscode-descriptionForeground)]">
																		Up to{" "}
																		<span
																			className={
																				isLightTheme
																					? "text-teal-600 font-medium"
																					: "text-emerald-400 font-medium"
																			}>
																			40%
																		</span>{" "}
																		boost credits
																	</div>
																	<div className="text-[var(--vscode-descriptionForeground)]">
																		First month:{" "}
																		<span
																			className={
																				isLightTheme
																					? "text-teal-600 font-medium"
																					: "text-emerald-400 font-medium"
																			}>
																			+50%
																		</span>{" "}
																		boost credits
																	</div>
																</div>

																{/* Button */}
																<VSCodeButton
																	appearance={
																		plan.recommended ? "primary" : "secondary"
																	}
																	className="w-full"
																	onClick={handleGetKiloPass}>
																	{t("kilocode:profile.kiloPass.action")}
																</VSCodeButton>
															</div>
														))}
													</div>

													{/* Footer info */}
													<div className="text-xs text-[var(--vscode-descriptionForeground)] mb-4">
														Pass credits never expire. Boost credits unlock after consuming
														a month of pass credits and expire at the end of each monthly
														cycle.
													</div>
												</>
											)}

											<VSCodeDivider className="w-full my-6" />

											{/* One-time Top-up Section */}
											<div className="text-lg font-semibold text-[var(--vscode-foreground)] mb-4 text-center">
												{t("kilocode:profile.shop.title")}
											</div>
											<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-4 text-center">
												{t("kilocode:profile.shop.description")}
											</div>

											<div className="grid grid-cols-2 min-[300px]:grid-cols-4 gap-3 mb-6">
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
