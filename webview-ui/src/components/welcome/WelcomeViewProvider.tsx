import { useCallback, useEffect, useRef, useState } from "react"
import { VSCodeLink, VSCodeProgressRing, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { validateApiConfiguration } from "@src/utils/validate"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button } from "@src/components/ui"

import ApiOptions from "../settings/ApiOptions"
import { Tab, TabContent } from "../common/Tab"

import RooHero from "./RooHero"
import { Trans } from "react-i18next"
import { ArrowLeft } from "lucide-react"

type ProviderOption = "roo" | "custom"

const WelcomeViewProvider = () => {
	const { apiConfiguration, currentApiConfigName, setApiConfiguration, uriScheme, cloudIsAuthenticated } =
		useExtensionState()
	const { t } = useAppTranslation()
	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
	const [selectedProvider, setSelectedProvider] = useState<ProviderOption>("roo")
	const [authInProgress, setAuthInProgress] = useState(false)
	const [showManualEntry, setShowManualEntry] = useState(false)
	const [manualUrl, setManualUrl] = useState("")
	const manualUrlInputRef = useRef<HTMLInputElement | null>(null)

	// When auth completes during the provider signup flow, save the Roo config
	// This will cause showWelcome to become false and navigate to chat
	useEffect(() => {
		if (cloudIsAuthenticated && authInProgress) {
			// Auth completed from provider signup flow - save the config now
			const rooConfig: ProviderSettings = {
				apiProvider: "roo",
			}
			vscode.postMessage({
				type: "upsertApiConfiguration",
				text: currentApiConfigName,
				apiConfiguration: rooConfig,
			})
			setAuthInProgress(false)
			setShowManualEntry(false)
		}
	}, [cloudIsAuthenticated, authInProgress, currentApiConfigName])

	// Focus the manual URL input when it becomes visible
	useEffect(() => {
		if (showManualEntry && manualUrlInputRef.current) {
			setTimeout(() => {
				manualUrlInputRef.current?.focus()
			}, 50)
		}
	}, [showManualEntry])

	// Memoize the setApiConfigurationField function to pass to ApiOptions
	const setApiConfigurationFieldForApiOptions = useCallback(
		<K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => {
			setApiConfiguration({ [field]: value })
		},
		[setApiConfiguration], // setApiConfiguration from context is stable
	)

	const handleGetStarted = useCallback(() => {
		if (selectedProvider === "roo") {
			// Trigger cloud sign-in with provider signup flow
			// NOTE: We intentionally do NOT save the API configuration yet.
			// The configuration will be saved by the extension after auth completes.
			// This keeps showWelcome true so we can show the waiting state.
			vscode.postMessage({ type: "rooCloudSignIn", useProviderSignup: true })

			// Show the waiting state
			setAuthInProgress(true)
		} else {
			// Use custom provider - validate first
			const error = apiConfiguration ? validateApiConfiguration(apiConfiguration) : undefined

			if (error) {
				setErrorMessage(error)
				return
			}

			setErrorMessage(undefined)
			vscode.postMessage({ type: "upsertApiConfiguration", text: currentApiConfigName, apiConfiguration })
		}
	}, [selectedProvider, apiConfiguration, currentApiConfigName])

	const handleGoBack = useCallback(() => {
		setAuthInProgress(false)
		setShowManualEntry(false)
		setManualUrl("")
	}, [])

	const handleManualUrlChange = (e: any) => {
		const url = e.target.value
		setManualUrl(url)

		// Auto-trigger authentication when a complete URL is pasted
		setTimeout(() => {
			if (url.trim() && url.includes("://") && url.includes("/auth/clerk/callback")) {
				vscode.postMessage({ type: "rooCloudManualUrl", text: url.trim() })
			}
		}, 100)
	}

	const handleKeyDown = (e: any) => {
		if (e.key === "Enter") {
			const url = manualUrl.trim()
			if (url && url.includes("://") && url.includes("/auth/clerk/callback")) {
				vscode.postMessage({ type: "rooCloudManualUrl", text: url })
			}
		}
	}

	const handleOpenSignupUrl = () => {
		vscode.postMessage({ type: "rooCloudSignIn", useProviderSignup: true })
	}

	// Render the waiting for cloud state
	if (authInProgress) {
		return (
			<Tab>
				<TabContent className="flex flex-col gap-4 p-6">
					<div className="flex flex-col items-start gap-4 pt-8">
						<VSCodeProgressRing className="size-6" />
						<h2 className="mt-0 mb-0 text-lg font-semibold">{t("welcome:waitingForCloud.heading")}</h2>
						<p className="text-sm text-vscode-descriptionForeground mt-0">
							{t("welcome:waitingForCloud.description")}
						</p>

						<p className="text-sm text-vscode-descriptionForeground mt-2">
							<Trans
								i18nKey="welcome:waitingForCloud.noPrompt"
								components={{
									clickHere: (
										<button
											onClick={handleOpenSignupUrl}
											className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline cursor-pointer bg-transparent border-none p-0 text-sm"
										/>
									),
								}}
							/>
						</p>

						<p className="text-sm text-vscode-descriptionForeground">
							<Trans
								i18nKey="welcome:waitingForCloud.havingTrouble"
								components={{
									clickHere: (
										<button
											onClick={() => setShowManualEntry(true)}
											className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline cursor-pointer bg-transparent border-none p-0 text-sm"
										/>
									),
								}}
							/>
						</p>

						{showManualEntry && (
							<div className="mt-2 w-full max-w-sm">
								<p className="text-sm text-vscode-descriptionForeground mb-2">
									{t("welcome:waitingForCloud.pasteUrl")}
								</p>
								<VSCodeTextField
									ref={manualUrlInputRef as any}
									value={manualUrl}
									onChange={handleManualUrlChange}
									onKeyDown={handleKeyDown}
									placeholder="vscode://RooVeterinaryInc.roo-cline/auth/clerk/callback?state=..."
									className="w-full"
								/>
							</div>
						)}
					</div>
				</TabContent>
				<div className="sticky bottom-0 bg-vscode-sideBar-background p-4 border-t border-vscode-panel-border">
					<Button onClick={handleGoBack} variant="secondary" className="flex items-center gap-2">
						<ArrowLeft className="size-4" />
						{t("welcome:waitingForCloud.goBack")}
					</Button>
				</div>
			</Tab>
		)
	}

	return (
		<Tab>
			<TabContent className="flex flex-col gap-4 p-6">
				<RooHero />
				<h2 className="mt-0 mb-0 text-xl">{t("welcome:greeting")}</h2>

				<div className="text-base text-vscode-foreground">
					<p className="mb-3 leading-relaxed">
						<Trans i18nKey="welcome:introduction" />
					</p>
					<p className="mb-0 leading-relaxed">
						<Trans i18nKey="welcome:chooseProvider" />
					</p>
				</div>

				<div className="mb-4">
					{/* Roo Code Cloud Provider Option */}
					<div
						className="flex items-start gap-3 p-4 mb-3 border border-vscode-panel-border rounded-md cursor-pointer hover:bg-vscode-list-hoverBackground"
						onClick={() => setSelectedProvider("roo")}>
						<input
							type="radio"
							name="provider"
							checked={selectedProvider === "roo"}
							onChange={() => setSelectedProvider("roo")}
							className="mt-1"
						/>
						<div className="flex-1">
							<span className="text-sm font-semibold mb-2 block">
								{t("welcome:providerSignup.rooCloudProvider")}
							</span>
							<p className="text-xs text-vscode-descriptionForeground mb-1">
								{t("welcome:providerSignup.rooCloudDescription")} (
								<VSCodeLink
									href="https://roocode.com/provider/pricing?utm_source=extension&utm_medium=welcome-screen&utm_campaign=provider-signup&utm_content=learn-more"
									className="text-xs">
									{t("welcome:providerSignup.learnMore")}
								</VSCodeLink>
								).
							</p>
						</div>
					</div>

					{/* Use Another Provider Option */}
					<div
						className="flex items-start gap-3 p-4 mb-4 border border-vscode-panel-border rounded-md cursor-pointer hover:bg-vscode-list-hoverBackground"
						onClick={() => setSelectedProvider("custom")}>
						<input
							type="radio"
							name="provider"
							checked={selectedProvider === "custom"}
							onChange={() => setSelectedProvider("custom")}
							className="mt-1"
						/>
						<div className="flex-1">
							<span className="text-sm font-semibold mb-2 block">
								{t("welcome:providerSignup.useAnotherProvider")}
							</span>
							<p className="text-xs text-vscode-descriptionForeground mb-1">
								{t("welcome:providerSignup.useAnotherProviderDescription")}
							</p>
						</div>
					</div>

					{/* Show API options only when custom provider is selected */}
					{selectedProvider === "custom" && (
						<div className="mt-4">
							<ApiOptions
								fromWelcomeView
								apiConfiguration={apiConfiguration || {}}
								uriScheme={uriScheme}
								setApiConfigurationField={setApiConfigurationFieldForApiOptions}
								errorMessage={errorMessage}
								setErrorMessage={setErrorMessage}
							/>
						</div>
					)}
				</div>
			</TabContent>
			<div className="sticky bottom-0 bg-vscode-sideBar-background p-4 border-t border-vscode-panel-border">
				<div className="flex flex-col gap-2">
					<Button onClick={handleGetStarted} variant="primary">
						{t("welcome:providerSignup.getStarted")} →
					</Button>
					{errorMessage && selectedProvider === "custom" && (
						<div className="text-vscode-errorForeground text-sm">{errorMessage}</div>
					)}
				</div>
			</div>
		</Tab>
	)
}

export default WelcomeViewProvider
