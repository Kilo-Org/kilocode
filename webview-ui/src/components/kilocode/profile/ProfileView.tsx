import React, { useEffect } from "react"
import { Trans } from "react-i18next"
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
import { useIsLightTheme } from "../hooks/useIsLightTheme"

interface ProfileViewProps {
	onDone: () => void
}

const ProfileView: React.FC<ProfileViewProps> = ({ onDone }) => {
	const { apiConfiguration, currentApiConfigName, uriScheme, uiKind } = useExtensionState()
	const { t } = useAppTranslation()

	const isLightTheme = useIsLightTheme()
	const [profileData, setProfileData] = React.useState<ProfileData | undefined | null>(null)
	const [balance, setBalance] = React.useState<number | null>(null)
	const [isLoadingBalance, setIsLoadingBalance] = React.useState(true)
	const [isLoadingUser, setIsLoadingUser] = React.useState(true)
	const [kiloPassState, setKiloPassState] = React.useState<KiloPassSubscriptionState | null>(null)
	const [isLoadingKiloPass, setIsLoadingKiloPass] = React.useState(true)
	const organizationId = apiConfiguration?.kilocodeOrganizationId

	useEffect(() => {
		setIsLoadingUser(true)
		setIsLoadingBalance(true)
		setIsLoadingKiloPass(true)
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
		},
		{
			name: "Pro",
			price: 49,
		},
		{
			name: "Expert",
			price: 199,
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
												/* Show current subscription info - matching backend design */
												<div className="mb-6">
													{/* Main subscription card */}
													<div className="border rounded-xl p-4 bg-[var(--vscode-editor-background)] border-[var(--vscode-panel-border)]">
														{/* Header with icon, tier info, status badge, and settings */}
														<div className="flex items-start justify-between mb-4">
															<div className="flex items-center gap-3">
																<div
																	className={`size-9 rounded-lg flex items-center justify-center ${
																		isLightTheme
																			? "bg-gradient-to-br from-amber-400/30 to-amber-200/10 ring-1 ring-amber-500/25"
																			: "bg-gradient-to-br from-amber-500/30 to-amber-300/10 ring-1 ring-amber-400/25"
																	}`}>
																	<span
																		className={`codicon codicon-credit-card ${isLightTheme ? "text-amber-600" : "text-amber-300"}`}></span>
																</div>
																<div className="leading-none">
																	<div className="font-semibold text-[var(--vscode-foreground)]">
																		{t("kilocode:profile.kiloPass.title")}
																	</div>
																	<div className="text-sm text-[var(--vscode-descriptionForeground)] mt-0.5">
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
															<div className="flex items-center gap-2">
																<span
																	className={`text-xs px-3 py-1 rounded font-medium border ${
																		kiloPassState.cancelAtPeriodEnd
																			? isLightTheme
																				? "border-amber-500 text-amber-600"
																				: "border-amber-600/50 text-amber-400"
																			: kiloPassState.status === "active"
																				? isLightTheme
																					? "border-gray-400 text-gray-700"
																					: "border-[var(--vscode-widget-border)] text-[var(--vscode-foreground)]"
																				: isLightTheme
																					? "border-amber-500 text-amber-600"
																					: "border-amber-600/50 text-amber-400"
																	}`}>
																	{kiloPassState.cancelAtPeriodEnd
																		? t(
																				"kilocode:profile.kiloPass.status.cancelling",
																			)
																		: t(
																				`kilocode:profile.kiloPass.status.${kiloPassState.status}`,
																			)}
																</span>
																<button
																	onClick={() => {
																		vscode.postMessage({
																			type: "openExternal",
																			url: getAppUrl("/profile"),
																		})
																	}}
																	className="size-9 rounded border flex items-center justify-center hover:bg-[var(--vscode-toolbar-hoverBackground)] border-[var(--vscode-panel-border)]">
																	<span className="codicon codicon-settings-gear text-[var(--vscode-descriptionForeground)]"></span>
																</button>
															</div>
														</div>

														{/* Usage Progress Section */}
														{(() => {
															const baseUsd = kiloPassState.currentPeriodBaseCreditsUsd
															const usageUsd = kiloPassState.currentPeriodUsageUsd
															const bonusUsd =
																kiloPassState.currentPeriodBonusCreditsUsd ?? 0
															const totalAvailable = baseUsd + bonusUsd
															const nonNegativeUsage = Math.max(0, usageUsd)

															// Calculate percentages for the progress bar
															const pctOfBaseInTotal =
																totalAvailable > 0
																	? (baseUsd / totalAvailable) * 100
																	: 0
															const usagePctOfTotal =
																totalAvailable > 0
																	? Math.min(
																			(nonNegativeUsage / totalAvailable) * 100,
																			100,
																		)
																	: 0
															const paidFillPct = Math.min(
																usagePctOfTotal,
																pctOfBaseInTotal,
															)
															const bonusFillPct = Math.max(
																0,
																usagePctOfTotal - pctOfBaseInTotal,
															)

															// Determine status color
															const isOverAvailable = usageUsd > totalAvailable
															const statusColorClass = isOverAvailable
																? isLightTheme
																	? "text-red-600"
																	: "text-red-400"
																: kiloPassState.isBonusUnlocked
																	? isLightTheme
																		? "text-emerald-600"
																		: "text-emerald-300"
																	: isLightTheme
																		? "text-amber-500"
																		: "text-amber-300"

															return (
																<div className="rounded-lg border p-3 mb-3 border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)]">
																	{/* Header: This month's usage + amount */}
																	<div className="flex items-center justify-between mb-2 text-sm">
																		<span className="text-[var(--vscode-descriptionForeground)]">
																			{t(
																				"kilocode:profile.kiloPass.boost.monthlyUsage",
																			)}
																		</span>
																		<span
																			className={`font-mono font-semibold ${statusColorClass}`}>
																			${nonNegativeUsage.toFixed(2)} / $
																			{totalAvailable.toFixed(2)}
																		</span>
																	</div>

																	{/* Two-tone progress bar */}
																	<div className="space-y-2">
																		<div
																			className={`relative h-3 rounded-full overflow-visible ${
																				isLightTheme
																					? "bg-gray-200/50"
																					: "bg-[var(--vscode-widget-border)]/30"
																			}`}>
																			{/* Background segments showing paid vs bonus sections */}
																			<div
																				className="absolute inset-y-0 left-0 opacity-30"
																				style={{
																					width: `${pctOfBaseInTotal}%`,
																					background: isLightTheme
																						? "rgba(245,158,11,0.3)"
																						: "rgba(245,158,11,0.20)",
																				}}
																			/>
																			<div
																				className="absolute inset-y-0 opacity-30"
																				style={{
																					left: `${pctOfBaseInTotal}%`,
																					width: `${100 - pctOfBaseInTotal}%`,
																					background: isLightTheme
																						? "rgba(16,185,129,0.3)"
																						: "rgba(16,185,129,0.20)",
																				}}
																			/>

																			{/* Filled paid portion */}
																			<div
																				className={`absolute inset-y-0 left-0 rounded-l-full transition-all duration-300 ${
																					isLightTheme
																						? "bg-gradient-to-r from-amber-500 to-amber-400"
																						: "bg-gradient-to-r from-amber-500 to-amber-400"
																				}`}
																				style={{ width: `${paidFillPct}%` }}
																			/>

																			{/* Filled bonus portion */}
																			{bonusFillPct > 0 && (
																				<div
																					className={`absolute inset-y-0 rounded-r-full transition-all duration-300 ${
																						isLightTheme
																							? "bg-gradient-to-r from-emerald-500 to-emerald-400"
																							: "bg-gradient-to-r from-emerald-500 to-emerald-400"
																					}`}
																					style={{
																						left: `${pctOfBaseInTotal}%`,
																						width: `${bonusFillPct}%`,
																					}}
																				/>
																			)}

																			{/* Divider tick mark */}
																			<div
																				className={`absolute top-full mt-0.5 h-1.5 w-0.5 rounded ${
																					isLightTheme
																						? "bg-gray-400"
																						: "bg-white/40"
																				}`}
																				style={{
																					left: `calc(${pctOfBaseInTotal}% - 1px)`,
																				}}
																			/>
																		</div>

																		{/* Labels below bar */}
																		<div className="relative h-4">
																			<span
																				className={`absolute -translate-x-1/2 font-mono text-xs font-semibold ${
																					isLightTheme
																						? "text-amber-500"
																						: "text-amber-300"
																				}`}
																				style={{
																					left: `${pctOfBaseInTotal}%`,
																				}}>
																				${baseUsd.toFixed(2)}
																			</span>
																			<span
																				className={`absolute right-0 font-mono text-xs font-semibold ${
																					isLightTheme
																						? "text-emerald-600"
																						: "text-emerald-300"
																				}`}>
																				${bonusUsd.toFixed(2)}
																			</span>
																		</div>

																		{/* Legend */}
																		<div className="flex items-center justify-between text-xs text-[var(--vscode-descriptionForeground)]">
																			<div className="flex items-center gap-2">
																				<span
																					className={`h-2 w-2 rounded-sm ${
																						isLightTheme
																							? "bg-amber-500"
																							: "bg-amber-400/80"
																					}`}
																				/>
																				{t(
																					"kilocode:profile.kiloPass.legend.paid",
																				)}
																			</div>
																			<div className="flex items-center gap-2">
																				<span
																					className={`h-2 w-2 rounded-sm ${
																						isLightTheme
																							? "bg-emerald-500"
																							: "bg-emerald-400/80"
																					}`}
																				/>
																				{t(
																					"kilocode:profile.kiloPass.legend.freeBonus",
																				)}
																			</div>
																		</div>
																	</div>
																</div>
															)
														})()}

														{/* Renewal / Active Until Row */}
														{(kiloPassState.refillAt || kiloPassState.nextBillingAt) && (
															<div className="rounded-lg border px-4 py-3 mb-3 border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)]">
																<div className="flex items-center justify-between gap-4 text-sm">
																	<div className="flex items-start gap-2">
																		<span
																			className={`codicon codicon-calendar mt-0.5 ${
																				isLightTheme
																					? "text-gray-400"
																					: "text-white/40"
																			}`}></span>
																		<div className="text-[var(--vscode-descriptionForeground)]">
																			{kiloPassState.cancelAtPeriodEnd ? (
																				t(
																					"kilocode:profile.kiloPass.activeUntilLabel",
																				)
																			) : (
																				<>
																					{(() => {
																						const refillDate = new Date(
																							kiloPassState.refillAt ||
																								kiloPassState.nextBillingAt!,
																						)
																						const now = new Date()
																						const diffDays = Math.ceil(
																							(refillDate.getTime() -
																								now.getTime()) /
																								(1000 * 60 * 60 * 24),
																						)
																						const baseUsd =
																							kiloPassState.currentPeriodBaseCreditsUsd
																						const bonusUsd =
																							kiloPassState.currentPeriodBonusCreditsUsd ??
																							0

																						return (
																							<Trans
																								i18nKey="kilocode:profile.kiloPass.renewsWithCredits"
																								values={{
																									days: diffDays,
																									paid: baseUsd.toFixed(
																										2,
																									),
																									bonus: bonusUsd.toFixed(
																										2,
																									),
																								}}
																								components={{
																									paid: (
																										<span
																											className={
																												isLightTheme
																													? "font-mono font-semibold text-amber-500"
																													: "font-mono font-semibold text-amber-300"
																											}
																										/>
																									),
																									bonus: (
																										<span
																											className={
																												isLightTheme
																													? "font-mono font-semibold text-emerald-600"
																													: "font-mono font-semibold text-emerald-300"
																											}
																										/>
																									),
																								}}
																							/>
																						)
																					})()}
																				</>
																			)}
																		</div>
																	</div>
																	<span className="shrink-0 text-[var(--vscode-descriptionForeground)]">
																		{new Date(
																			kiloPassState.refillAt ||
																				kiloPassState.nextBillingAt!,
																		).toLocaleDateString(undefined, {
																			month: "short",
																			day: "numeric",
																			year: "numeric",
																		})}
																	</span>
																</div>
															</div>
														)}

														{/* Bottom clarification text - only for monthly cadence (matching cloud behavior) */}
														{kiloPassState.cadence === "monthly" && (
															<div className="text-xs text-[var(--vscode-descriptionForeground)] leading-relaxed">
																<Trans
																	i18nKey="kilocode:profile.kiloPass.creditsExplanation"
																	values={{
																		expiryDate: kiloPassState.refillAt
																			? new Date(
																					kiloPassState.refillAt,
																				).toLocaleDateString(undefined, {
																					month: "short",
																					day: "numeric",
																					year: "numeric",
																				})
																			: "",
																	}}
																/>
															</div>
														)}
													</div>
												</div>
											) : (
												/* Show subscription options */
												<>
													<div className="text-xl font-semibold text-[var(--vscode-foreground)] mb-1 text-center">
														{t("kilocode:profile.kiloPass.title")}
													</div>
													<div className="text-sm text-[var(--vscode-descriptionForeground)] mb-4 text-center">
														<Trans
															i18nKey="kilocode:profile.kiloPass.promo"
															components={{
																boost: (
																	<span
																		className={
																			isLightTheme
																				? "text-teal-600 font-medium"
																				: "text-emerald-400 font-medium"
																		}
																	/>
																),
															}}
														/>
													</div>

													<div className="grid grid-cols-1 min-[600px]:grid-cols-3 gap-3 mb-4">
														{subscriptionPlans.map((plan) => (
															<div
																key={plan.name}
																className="relative border rounded-lg p-3 bg-[var(--vscode-editor-background)] transition-all hover:shadow-md border-[var(--vscode-input-border)]">
																{/* Header: Plan name + Monthly */}
																<div className="flex justify-between items-center mb-2">
																	<span className="font-semibold text-[var(--vscode-foreground)]">
																		{plan.name}
																	</span>
																	<span className="text-xs text-[var(--vscode-descriptionForeground)]">
																		{t("kilocode:profile.kiloPass.plans.monthly")}
																	</span>
																</div>

																{/* Price */}
																<div className="text-2xl font-bold text-[var(--vscode-foreground)] mb-3">
																	${plan.price}
																	<span className="text-sm font-normal text-[var(--vscode-descriptionForeground)]">
																		{t("kilocode:profile.kiloPass.plans.perMonth")}
																	</span>
																</div>

																{/* Details */}
																<div className="space-y-1 text-xs mb-3">
																	<div className="text-[var(--vscode-descriptionForeground)]">
																		<Trans
																			i18nKey="kilocode:profile.kiloPass.plans.includesCredits"
																			values={{ price: plan.price }}
																			components={{
																				highlight: (
																					<span
																						className={
																							isLightTheme
																								? "text-orange-500 font-medium"
																								: "text-yellow-500 font-medium"
																						}
																					/>
																				),
																			}}
																		/>
																	</div>
																	<div className="text-[var(--vscode-descriptionForeground)]">
																		<Trans
																			i18nKey="kilocode:profile.kiloPass.plans.upToBoost"
																			values={{ percent: 40 }}
																			components={{
																				highlight: (
																					<span
																						className={
																							isLightTheme
																								? "text-teal-600 font-medium"
																								: "text-emerald-400 font-medium"
																						}
																					/>
																				),
																			}}
																		/>
																	</div>
																	<div className="text-[var(--vscode-descriptionForeground)]">
																		<Trans
																			i18nKey="kilocode:profile.kiloPass.plans.firstMonthBoost"
																			values={{ percent: 50 }}
																			components={{
																				highlight: (
																					<span
																						className={
																							isLightTheme
																								? "text-teal-600 font-medium"
																								: "text-emerald-400 font-medium"
																						}
																					/>
																				),
																			}}
																		/>
																	</div>
																</div>

																{/* Button */}
																<VSCodeButton
																	appearance="primary"
																	className="w-full"
																	onClick={handleGetKiloPass}>
																	{t("kilocode:profile.kiloPass.action")}
																</VSCodeButton>
															</div>
														))}
													</div>

													{/* Footer info */}
													<div className="text-xs text-[var(--vscode-descriptionForeground)] mb-4">
														{t("kilocode:profile.kiloPass.subscriptionNote")}
													</div>
												</>
											)}

											<VSCodeDivider className="w-full my-6" />

											{/* Buy Credits Section */}
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
