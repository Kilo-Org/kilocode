import axios from "axios"
import * as vscode from "vscode"
import { getKiloUrlFromToken } from "@roo-code/types"
import { resolveKiloUserToken } from "../kilo-user-resolver"
import type { ClineProvider } from "../../webview/ClineProvider"
import type { WebviewMessage, ProfileData } from "../../../shared/WebviewMessage"
import { webviewMessageHandler } from "../../webview/webviewMessageHandler"

/**
 * Tracks notification IDs that have been shown as native notifications
 * to prevent duplicate native notifications
 */
const shownNativeNotificationIds = new Set<string>()

/**
 * Profile context containing token and related metadata
 */
interface ProfileContext {
	kilocodeToken: string
	profileName?: string
	kilocodeOrganizationId?: string
	kilocodeTesterWarningsDisabledUntil?: number
}

/**
 * Builds HTTP headers for Kilo API requests
 */
function buildKiloApiHeaders(context: ProfileContext): Record<string, string> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${context.kilocodeToken}`,
		"Content-Type": "application/json",
	}

	// Add organization header if present
	if (context.kilocodeOrganizationId) {
		headers["X-KiloCode-OrganizationId"] = context.kilocodeOrganizationId
	}

	// Add tester suppression header if enabled and not expired
	if (context.kilocodeTesterWarningsDisabledUntil && context.kilocodeTesterWarningsDisabledUntil > Date.now()) {
		headers["X-KILOCODE-TESTER"] = "SUPPRESS"
	}

	return headers
}

/**
 * Formats error message from axios error or generic error
 */
function formatErrorMessage(error: any, defaultMessage: string): string {
	return error.response?.data?.message || error.message || defaultMessage
}

/**
 * Resolves profile context for a specific profile name
 */
async function resolveSpecificProfile(
	provider: ClineProvider,
	profileName: string,
): Promise<ProfileContext | { error: string }> {
	try {
		const profile = await provider.providerSettingsManager.getProfile({ name: profileName })
		if (profile.apiProvider === "kilocode" && profile.kilocodeToken) {
			return {
				kilocodeToken: profile.kilocodeToken,
				profileName,
				kilocodeOrganizationId: profile.kilocodeOrganizationId,
				kilocodeTesterWarningsDisabledUntil: profile.kilocodeTesterWarningsDisabledUntil,
			}
		}
		return { error: `Profile '${profileName}' is not configured with Kilocode.` }
	} catch (error) {
		provider.log(`Failed to get profile '${profileName}': ${error}`)
		return { error: `Profile '${profileName}' not found.` }
	}
}

/**
 * Resolves profile context using global resolution (active or first kilocode profile)
 */
async function resolveGlobalProfile(provider: ClineProvider): Promise<ProfileContext | { error: string }> {
	const kilocodeToken = await resolveKiloUserToken(provider)

	if (!kilocodeToken) {
		return { error: "No KiloCode profile configured." }
	}

	// Get the profile details for the resolved token
	const { apiConfiguration, currentApiConfigName } = await provider.getState()

	// Check if token is from active profile
	if (apiConfiguration?.apiProvider === "kilocode" && apiConfiguration?.kilocodeToken === kilocodeToken) {
		return {
			kilocodeToken,
			profileName: currentApiConfigName,
			kilocodeOrganizationId: apiConfiguration.kilocodeOrganizationId,
			kilocodeTesterWarningsDisabledUntil: apiConfiguration.kilocodeTesterWarningsDisabledUntil,
		}
	}

	// Token is from another profile, find it
	const profiles = await provider.providerSettingsManager.listConfig()
	for (const profile of profiles) {
		if (profile.apiProvider !== "kilocode") continue

		try {
			const fullProfile = await provider.providerSettingsManager.getProfile({ name: profile.name })
			if (fullProfile.apiProvider === "kilocode" && fullProfile.kilocodeToken === kilocodeToken) {
				return {
					kilocodeToken,
					profileName: profile.name,
					kilocodeOrganizationId: fullProfile.kilocodeOrganizationId,
					kilocodeTesterWarningsDisabledUntil: fullProfile.kilocodeTesterWarningsDisabledUntil,
				}
			}
		} catch {
			continue
		}
	}

	// Token found but couldn't locate profile details
	return {
		kilocodeToken,
		profileName: undefined,
		kilocodeOrganizationId: undefined,
		kilocodeTesterWarningsDisabledUntil: undefined,
	}
}

/**
 * Handles fetchProfileDataRequest message
 * Fetches profile data from Kilo API using either a specific profile or global resolution
 */
export async function handleFetchProfileDataRequest(
	provider: ClineProvider,
	message: WebviewMessage,
	getGlobalState: <K extends keyof import("@roo-code/types").GlobalState>(
		key: K,
	) => import("@roo-code/types").GlobalState[K],
	updateGlobalState: <K extends keyof import("@roo-code/types").GlobalState>(
		key: K,
		value: import("@roo-code/types").GlobalState[K],
	) => Promise<void>,
): Promise<void> {
	try {
		// Resolve profile context (specific or global)
		const requestedProfileName = message.profileName
		const contextResult = requestedProfileName
			? await resolveSpecificProfile(provider, requestedProfileName)
			: await resolveGlobalProfile(provider)

		// Handle resolution errors
		if ("error" in contextResult) {
			provider.log(contextResult.error)
			provider.postMessageToWebview({
				type: "profileDataResponse",
				payload: { success: false, error: contextResult.error },
			})
			return
		}

		const context = contextResult
		const headers = buildKiloApiHeaders(context)

		// Fetch profile data from API
		const url = getKiloUrlFromToken("https://api.kilo.ai/api/profile", context.kilocodeToken)
		const response = await axios.get<Omit<ProfileData, "kilocodeToken">>(url, { headers })

		// Only perform organization validation and auto-switch if this is for the active profile
		if (!requestedProfileName || requestedProfileName === (await provider.getState()).currentApiConfigName) {
			const { apiConfiguration, currentApiConfigName } = await provider.getState()

			// Go back to Personal when no longer part of the current set organization
			const organizationExists = (response.data.organizations ?? []).some(
				({ id }) => id === context.kilocodeOrganizationId,
			)
			if (context.kilocodeOrganizationId && !organizationExists) {
				provider.upsertProviderProfile(currentApiConfigName ?? "default", {
					...apiConfiguration,
					kilocodeOrganizationId: undefined,
				})
			}

			try {
				// Skip auto-switch in YOLO mode (cloud agents, CI) to prevent usage billing issues
				const shouldAutoSwitch =
					!getGlobalState("yoloMode") &&
					response.data.organizations &&
					response.data.organizations.length > 0 &&
					!context.kilocodeOrganizationId &&
					!getGlobalState("hasPerformedOrganizationAutoSwitch")

				if (shouldAutoSwitch) {
					const firstOrg = response.data.organizations![0]
					provider.log(
						`[Auto-switch] Performing automatic organization switch to: ${firstOrg.name} (${firstOrg.id})`,
					)

					const upsertMessage: WebviewMessage = {
						type: "upsertApiConfiguration",
						text: currentApiConfigName ?? "default",
						apiConfiguration: {
							...apiConfiguration,
							kilocodeOrganizationId: firstOrg.id,
						},
					}

					await webviewMessageHandler(provider, upsertMessage)
					await updateGlobalState("hasPerformedOrganizationAutoSwitch", true)

					vscode.window.showInformationMessage(`Automatically switched to organization: ${firstOrg.name}`)

					provider.log(`[Auto-switch] Successfully switched to organization: ${firstOrg.name}`)
				}
			} catch (error) {
				provider.log(
					`[Auto-switch] Error during automatic organization switch: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		provider.postMessageToWebview({
			type: "profileDataResponse",
			payload: {
				success: true,
				data: { kilocodeToken: context.kilocodeToken, profileName: context.profileName, ...response.data },
			},
		})
	} catch (error: any) {
		const errorMessage = formatErrorMessage(error, "Failed to fetch general profile data from backend.")
		provider.log(`Error fetching general profile data: ${errorMessage}`)
		provider.postMessageToWebview({
			type: "profileDataResponse",
			payload: { success: false, error: errorMessage },
		})
	}
}

/**
 * Handles fetchBalanceDataRequest message
 * Fetches balance data from Kilo API for the active profile
 */
export async function handleFetchBalanceDataRequest(provider: ClineProvider): Promise<void> {
	try {
		const { apiConfiguration } = await provider.getState()
		const { kilocodeToken, kilocodeOrganizationId, kilocodeTesterWarningsDisabledUntil } = apiConfiguration ?? {}

		if (!kilocodeToken) {
			provider.log("KiloCode token not found in extension state for balance data.")
			provider.postMessageToWebview({
				type: "balanceDataResponse",
				payload: { success: false, error: "KiloCode API token not configured." },
			})
			return
		}

		const context: ProfileContext = {
			kilocodeToken,
			kilocodeOrganizationId,
			kilocodeTesterWarningsDisabledUntil,
		}
		const headers = buildKiloApiHeaders(context)

		const url = getKiloUrlFromToken("https://api.kilo.ai/api/profile/balance", kilocodeToken)
		const response = await axios.get(url, { headers })

		provider.postMessageToWebview({
			type: "balanceDataResponse",
			payload: { success: true, data: response.data },
		})
	} catch (error: any) {
		const errorMessage = formatErrorMessage(error, "Failed to fetch balance data from backend.")
		provider.log(`Error fetching balance data: ${errorMessage}`)
		provider.postMessageToWebview({
			type: "balanceDataResponse",
			payload: { success: false, error: errorMessage },
		})
	}
}

/**
 * Handles shopBuyCredits message
 * Redirects user to payment page for purchasing credits
 */
export async function handleShopBuyCredits(provider: ClineProvider, message: WebviewMessage): Promise<void> {
	try {
		// Use global kilocode token resolution instead of current profile
		const kilocodeToken = await resolveKiloUserToken(provider)

		if (!kilocodeToken) {
			provider.log("No KiloCode profile found for buy credits.")
			return
		}

		const credits = message.values?.credits || 50
		const uriScheme = message.values?.uriScheme || "vscode"
		const uiKind = message.values?.uiKind || "Desktop"
		const source = uiKind === "Web" ? "web" : uriScheme

		const url = getKiloUrlFromToken(
			`https://api.kilo.ai/payments/topup?origin=extension&source=${source}&amount=${credits}`,
			kilocodeToken,
		)

		const response = await axios.post(
			url,
			{},
			{
				headers: {
					Authorization: `Bearer ${kilocodeToken}`,
					"Content-Type": "application/json",
				},
				maxRedirects: 0, // Prevent axios from following redirects automatically
				validateStatus: (status) => status < 400, // Accept 3xx status codes
			},
		)

		if (response.status !== 303 || !response.headers.location) {
			return
		}

		await vscode.env.openExternal(vscode.Uri.parse(response.headers.location))
	} catch (error: any) {
		const errorMessage = error?.message || "Unknown error"
		const errorStack = error?.stack ? ` Stack: ${error.stack}` : ""
		provider.log(`Error redirecting to payment page: ${errorMessage}.${errorStack}`)
		provider.postMessageToWebview({
			type: "updateProfileData",
		})
	}
}

/**
 * Handles fetchKilocodeNotifications message
 * Fetches notifications from Kilo API using global token resolution
 */
export async function handleFetchKilocodeNotifications(provider: ClineProvider): Promise<void> {
	try {
		// Use global resolution to get profile context
		const contextResult = await resolveGlobalProfile(provider)

		// If no kilocode profile found, return empty notifications
		if ("error" in contextResult) {
			provider.postMessageToWebview({
				type: "kilocodeNotificationsResponse",
				notifications: [],
			})
			return
		}

		const context = contextResult
		const headers = buildKiloApiHeaders(context)

		// Fetch notifications from API
		const url = getKiloUrlFromToken("https://api.kilo.ai/api/users/notifications", context.kilocodeToken)
		const response = await axios.get(url, {
			headers,
			timeout: 5000,
		})

		const notifications = response.data?.notifications || []
		const dismissedIds = (await provider.getState()).dismissedNotificationIds || []

		// Filter notifications to only show new ones as native
		const notificationsToShowAsNative = notifications.filter(
			(notification: any) =>
				!dismissedIds.includes(notification.id) &&
				!shownNativeNotificationIds.has(notification.id) &&
				(notification.showIn ?? []).includes("extension-native"),
		)

		// Send notifications to webview (filter for extension display)
		provider.postMessageToWebview({
			type: "kilocodeNotificationsResponse",
			notifications: notifications.filter(
				({ showIn }: { showIn?: string[] }) => !showIn || showIn.includes("extension"),
			),
		})

		// Show native notifications
		for (const notification of notificationsToShowAsNative) {
			try {
				const message = `${notification.title}: ${notification.message}`
				const actionButton = notification.action?.actionText
				const dismissButton = "Do not show again"
				const selection = await vscode.window.showInformationMessage(
					message,
					...(actionButton ? [actionButton, dismissButton] : [dismissButton]),
				)

				if (selection) {
					const currentDismissedIds = dismissedIds || []
					if (!currentDismissedIds.includes(notification.id)) {
						await provider.contextProxy.setValue("dismissedNotificationIds", [
							...currentDismissedIds,
							notification.id,
						])
					}
				}

				if (selection === actionButton && notification.action?.actionURL) {
					await vscode.env.openExternal(vscode.Uri.parse(notification.action.actionURL))
				}

				shownNativeNotificationIds.add(notification.id)
			} catch (error: any) {
				provider.log(`Error displaying notification ${notification.id}: ${error.message}`)
			}
		}
	} catch (error: any) {
		provider.log(
			`Error fetching Kilocode notifications: ${formatErrorMessage(error, "Failed to fetch notifications")}`,
		)
		provider.postMessageToWebview({
			type: "kilocodeNotificationsResponse",
			notifications: [],
		})
	}
}
