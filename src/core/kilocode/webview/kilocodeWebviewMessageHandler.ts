// kilocode_change - new file
// Kilocode-specific message handler that processes Kilocode-only webview messages
// before falling through to the main handler.

import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import axios from "axios"

import { GlobalState, ghostServiceSettingsSchema, fastApplyModelSchema } from "@roo-code/types"
import { getKiloBaseUriFromToken } from "@roo-code/types"

import { ClineProvider } from "../../webview/ClineProvider"
import {
	WebviewMessage,
	ProfileData,
	SeeNewChangesPayload,
	TaskHistoryRequestPayload,
	TasksByIdRequestPayload,
} from "../../../shared/WebviewMessage"
import { t } from "../../../i18n"
import { showSystemNotification } from "../../../integrations/notifications"
import { singleCompletionHandler } from "../../../utils/single-completion-handler"
import { seeNewChanges } from "../../checkpoints/kilocode/seeNewChanges"
import { getTaskHistory } from "../../../shared/kilocode/getTaskHistory"
import { toggleWorkflow, toggleRule, createRuleFile, deleteRuleFile } from "../../webview/kilorules"
import { mermaidFixPrompt } from "../../prompts/utilities/mermaid"
import { editMessageHandler, fetchKilocodeNotificationsHandler } from "./webviewMessageHandlerUtils"
import { UsageTracker } from "../../../utils/usage-tracker"

export interface KilocodeMessageHandlerResult {
	handled: boolean
}

/**
 * Handles Kilocode-specific webview messages.
 * Returns { handled: true } if the message was processed, { handled: false } otherwise.
 */
export async function kilocodeWebviewMessageHandler(
	provider: ClineProvider,
	message: WebviewMessage,
	getGlobalState: <K extends keyof GlobalState>(key: K) => GlobalState[K],
	updateGlobalState: <K extends keyof GlobalState>(key: K, value: GlobalState[K]) => Promise<void>,
): Promise<KilocodeMessageHandlerResult> {
	switch (message.type) {
		// === Simple State/Action Handlers ===

		case "condense":
			provider.getCurrentTask()?.handleWebviewAskResponse("yesButtonClicked")
			return { handled: true }

		case "openGlobalKeybindings":
			vscode.commands.executeCommand("workbench.action.openGlobalKeybindings", message.text ?? "kilo-code.")
			return { handled: true }

		case "showSystemNotification": {
			const isSystemNotificationsEnabled = getGlobalState("systemNotificationsEnabled") ?? true
			if (!isSystemNotificationsEnabled && !message.alwaysAllow) {
				return { handled: true }
			}
			if (message.notificationOptions) {
				showSystemNotification(message.notificationOptions)
			}
			return { handled: true }
		}

		case "systemNotificationsEnabled": {
			const systemNotificationsEnabled = message.bool ?? true
			await updateGlobalState("systemNotificationsEnabled", systemNotificationsEnabled)
			await provider.postStateToWebview()
			return { handled: true }
		}

		case "openInBrowser":
			if (message.url) {
				vscode.env.openExternal(vscode.Uri.parse(message.url))
			}
			return { handled: true }

		case "morphApiKey":
			await updateGlobalState("morphApiKey", message.text)
			await provider.postStateToWebview()
			return { handled: true }

		case "fastApplyModel": {
			const nextModel = fastApplyModelSchema.safeParse(message.text).data ?? "auto"
			await updateGlobalState("fastApplyModel", nextModel)
			await provider.postStateToWebview()
			return { handled: true }
		}

		case "reportBug":
			provider.getCurrentTask()?.handleWebviewAskResponse("yesButtonClicked")
			return { handled: true }

		case "dismissNotificationId": {
			if (!message.notificationId) {
				return { handled: true }
			}

			const dismissedNotificationIds = getGlobalState("dismissedNotificationIds") || []
			await updateGlobalState("dismissedNotificationIds", [...dismissedNotificationIds, message.notificationId])
			await provider.postStateToWebview()
			return { handled: true }
		}

		// === Task History Handlers ===

		case "seeNewChanges": {
			const task = provider.getCurrentTask()
			if (task && message.payload) {
				await seeNewChanges(task, (message.payload as SeeNewChangesPayload).commitRange)
			}
			return { handled: true }
		}

		case "tasksByIdRequest": {
			const request = message.payload as TasksByIdRequestPayload
			await provider.postMessageToWebview({
				type: "tasksByIdResponse",
				payload: {
					requestId: request.requestId,
					tasks: provider.getTaskHistory().filter((task) => request.taskIds.includes(task.id)),
				},
			})
			return { handled: true }
		}

		case "taskHistoryRequest": {
			await provider.postMessageToWebview({
				type: "taskHistoryResponse",
				payload: getTaskHistory(
					provider.getTaskHistory(),
					provider.cwd,
					message.payload as TaskHistoryRequestPayload,
				),
			})
			return { handled: true }
		}

		case "toggleTaskFavorite":
			if (message.text) {
				await provider.toggleTaskFavorite(message.text)
			}
			return { handled: true }

		// === Rules/Workflow Handlers ===

		case "toggleWorkflow": {
			if (message.workflowPath && typeof message.enabled === "boolean" && typeof message.isGlobal === "boolean") {
				await toggleWorkflow(
					message.workflowPath,
					message.enabled,
					message.isGlobal,
					provider.contextProxy,
					provider.context,
				)
				await provider.postRulesDataToWebview()
			}
			return { handled: true }
		}

		case "toggleRule": {
			if (message.rulePath && typeof message.enabled === "boolean" && typeof message.isGlobal === "boolean") {
				await toggleRule(
					message.rulePath,
					message.enabled,
					message.isGlobal,
					provider.contextProxy,
					provider.context,
				)
				await provider.postRulesDataToWebview()
			}
			return { handled: true }
		}

		case "createRuleFile": {
			if (
				message.filename &&
				typeof message.isGlobal === "boolean" &&
				(message.ruleType === "rule" || message.ruleType === "workflow")
			) {
				try {
					await createRuleFile(message.filename, message.isGlobal, message.ruleType)
				} catch (error) {
					console.error("Error creating rule file:", error)
					vscode.window.showErrorMessage(t("kilocode:rules.errors.failedToCreateRuleFile"))
				}
				await provider.postRulesDataToWebview()
			}
			return { handled: true }
		}

		case "deleteRuleFile": {
			if (message.rulePath) {
				try {
					await deleteRuleFile(message.rulePath)
				} catch (error) {
					console.error("Error deleting rule file:", error)
					vscode.window.showErrorMessage(t("kilocode:rules.errors.failedToDeleteRuleFile"))
				}
				await provider.postRulesDataToWebview()
			}
			return { handled: true }
		}

		// === Usage/Data Handlers ===

		case "clearUsageData": {
			try {
				const usageTracker = UsageTracker.getInstance()
				await usageTracker.clearAllUsageData()
				vscode.window.showInformationMessage("Usage data has been successfully cleared.")
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				provider.log(`Error clearing usage data: ${errorMessage}`)
				vscode.window.showErrorMessage(`Failed to clear usage data: ${errorMessage}`)
			}
			return { handled: true }
		}

		case "getUsageData": {
			if (message.text) {
				try {
					const usageTracker = UsageTracker.getInstance()
					const usageData = usageTracker.getAllUsage(message.text)
					await provider.postMessageToWebview({
						type: "usageDataResponse",
						text: message.text,
						values: usageData,
					})
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error)
					provider.log(`Error getting usage data: ${errorMessage}`)
				}
			}
			return { handled: true }
		}

		// === Indexing Handlers ===

		case "cancelIndexing": {
			try {
				const manager = provider.getCurrentWorkspaceCodeIndexManager()
				if (!manager) {
					provider.postMessageToWebview({
						type: "indexingStatusUpdate",
						values: {
							systemStatus: "Error",
							message: t("embeddings:orchestrator.indexingRequiresWorkspace"),
							processedItems: 0,
							totalItems: 0,
							currentItemUnit: "items",
						},
					})
					provider.log("Cannot cancel indexing: No workspace folder open")
					return { handled: true }
				}
				if (manager.isFeatureEnabled && manager.isFeatureConfigured) {
					manager.cancelIndexing()
					// Immediately reflect updated status to UI
					provider.postMessageToWebview({
						type: "indexingStatusUpdate",
						values: manager.getCurrentStatus(),
					})
				}
			} catch (error) {
				provider.log(`Error canceling indexing: ${error instanceof Error ? error.message : String(error)}`)
			}
			return { handled: true }
		}

		// === AI/Completion Handlers ===

		case "fixMermaidSyntax": {
			if (message.text && message.requestId) {
				try {
					const { apiConfiguration } = await provider.getState()

					const prompt = mermaidFixPrompt(message.values?.error || "Unknown syntax error", message.text)

					const fixedCode = await singleCompletionHandler(apiConfiguration, prompt)

					provider.postMessageToWebview({
						type: "mermaidFixResponse",
						requestId: message.requestId,
						success: true,
						fixedCode: fixedCode?.trim() || null,
					})
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : "Failed to fix Mermaid syntax"
					provider.log(`Error fixing Mermaid syntax: ${errorMessage}`)

					provider.postMessageToWebview({
						type: "mermaidFixResponse",
						requestId: message.requestId,
						success: false,
						error: errorMessage,
					})
				}
			}
			return { handled: true }
		}

		// === Message Edit/Notification Handlers ===

		case "editMessage": {
			await editMessageHandler(provider, message)
			return { handled: true }
		}

		case "fetchKilocodeNotifications": {
			await fetchKilocodeNotificationsHandler(provider)
			return { handled: true }
		}

		// === Profile/Balance Handlers ===

		case "fetchProfileDataRequest": {
			try {
				const { apiConfiguration, currentApiConfigName } = await provider.getState()
				const kilocodeToken = apiConfiguration?.kilocodeToken

				if (!kilocodeToken) {
					provider.log("KiloCode token not found in extension state.")
					provider.postMessageToWebview({
						type: "profileDataResponse",
						payload: { success: false, error: "KiloCode API token not configured." },
					})
					return { handled: true }
				}

				const headers: Record<string, string> = {
					Authorization: `Bearer ${kilocodeToken}`,
					"Content-Type": "application/json",
				}

				// Add X-KILOCODE-TESTER: SUPPRESS header if the setting is enabled
				if (
					apiConfiguration.kilocodeTesterWarningsDisabledUntil &&
					apiConfiguration.kilocodeTesterWarningsDisabledUntil > Date.now()
				) {
					headers["X-KILOCODE-TESTER"] = "SUPPRESS"
				}

				const response = await axios.get<Omit<ProfileData, "kilocodeToken">>(
					`${getKiloBaseUriFromToken(kilocodeToken)}/api/profile`,
					{
						headers,
					},
				)

				// Go back to Personal when no longer part of the current set organization
				const organizationExists = (response.data.organizations ?? []).some(
					({ id }) => id === apiConfiguration?.kilocodeOrganizationId,
				)
				if (apiConfiguration?.kilocodeOrganizationId && !organizationExists) {
					provider.upsertProviderProfile(currentApiConfigName ?? "default", {
						...apiConfiguration,
						kilocodeOrganizationId: undefined,
					})
				}

				try {
					const shouldAutoSwitch =
						response.data.organizations &&
						response.data.organizations.length > 0 &&
						!apiConfiguration.kilocodeOrganizationId &&
						!getGlobalState("hasPerformedOrganizationAutoSwitch")

					if (shouldAutoSwitch) {
						const firstOrg = response.data.organizations![0]
						provider.log(
							`[Auto-switch] Performing automatic organization switch to: ${firstOrg.name} (${firstOrg.id})`,
						)

						// Import webviewMessageHandler to call recursively
						const { webviewMessageHandler } = await import("../../webview/webviewMessageHandler")

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

				provider.postMessageToWebview({
					type: "profileDataResponse",
					payload: { success: true, data: { kilocodeToken, ...response.data } },
				})
			} catch (error: any) {
				const errorMessage =
					error.response?.data?.message ||
					error.message ||
					"Failed to fetch general profile data from backend."
				provider.log(`Error fetching general profile data: ${errorMessage}`)
				provider.postMessageToWebview({
					type: "profileDataResponse",
					payload: { success: false, error: errorMessage },
				})
			}
			return { handled: true }
		}

		case "fetchBalanceDataRequest": {
			try {
				const { apiConfiguration } = await provider.getState()
				const { kilocodeToken, kilocodeOrganizationId } = apiConfiguration ?? {}

				if (!kilocodeToken) {
					provider.log("KiloCode token not found in extension state for balance data.")
					provider.postMessageToWebview({
						type: "balanceDataResponse",
						payload: { success: false, error: "KiloCode API token not configured." },
					})
					return { handled: true }
				}

				const headers: Record<string, string> = {
					Authorization: `Bearer ${kilocodeToken}`,
					"Content-Type": "application/json",
				}

				if (kilocodeOrganizationId) {
					headers["X-KiloCode-OrganizationId"] = kilocodeOrganizationId
				}

				// Add X-KILOCODE-TESTER: SUPPRESS header if the setting is enabled
				if (
					apiConfiguration.kilocodeTesterWarningsDisabledUntil &&
					apiConfiguration.kilocodeTesterWarningsDisabledUntil > Date.now()
				) {
					headers["X-KILOCODE-TESTER"] = "SUPPRESS"
				}

				const response = await axios.get(`${getKiloBaseUriFromToken(kilocodeToken)}/api/profile/balance`, {
					headers,
				})
				provider.postMessageToWebview({
					type: "balanceDataResponse",
					payload: { success: true, data: response.data },
				})
			} catch (error: any) {
				const errorMessage =
					error.response?.data?.message || error.message || "Failed to fetch balance data from backend."
				provider.log(`Error fetching balance data: ${errorMessage}`)
				provider.postMessageToWebview({
					type: "balanceDataResponse",
					payload: { success: false, error: errorMessage },
				})
			}
			return { handled: true }
		}

		case "shopBuyCredits": {
			try {
				const { apiConfiguration } = await provider.getState()
				const kilocodeToken = apiConfiguration?.kilocodeToken
				if (!kilocodeToken) {
					provider.log("KiloCode token not found in extension state for buy credits.")
					return { handled: true }
				}
				const credits = message.values?.credits || 50
				const uriScheme = message.values?.uriScheme || "vscode"
				const uiKind = message.values?.uiKind || "Desktop"
				const source = uiKind === "Web" ? "web" : uriScheme

				const baseUrl = getKiloBaseUriFromToken(kilocodeToken)
				const response = await axios.post(
					`${baseUrl}/payments/topup?origin=extension&source=${source}&amount=${credits}`,
					{},
					{
						headers: {
							Authorization: `Bearer ${kilocodeToken}`,
							"Content-Type": "application/json",
						},
						maxRedirects: 0,
						validateStatus: (status) => status < 400,
					},
				)
				if (response.status !== 303 || !response.headers.location) {
					return { handled: true }
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
			return { handled: true }
		}

		default:
			return { handled: false }
	}
}
