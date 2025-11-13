// kilocode_change - new file
/**
 * webview module exports functions which interfact with the webview provider
 * (i.e. ClineProvider)
 */

import { ClineProvider } from "../../../core/webview/ClineProvider"
import { t } from "../../../i18n"
import { OrganizationService } from "../../kilocode/OrganizationService"
import { CodeIndexManager } from "../manager"

export async function tryStartManagedIndexing(provider: ClineProvider): Promise<boolean> {
	try {
		const manager = provider.getCurrentWorkspaceCodeIndexManager()
		if (!manager) {
			// No workspace open - send error status
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
			provider.log("Cannot start indexing: No workspace folder open")
			return false
		}

		// kilocode_change start: Support managed indexing
		const [{ apiConfiguration }, kiloConfig] = await Promise.all([provider.getState(), provider.getKiloConfig()])
		const projectId = kiloConfig?.project?.id
		if (apiConfiguration.kilocodeToken && apiConfiguration.kilocodeOrganizationId && projectId) {
			provider.log(
				`[startIndexing] Setting Kilo org props: orgId=${apiConfiguration.kilocodeOrganizationId} projectId=${projectId}`,
			)
			manager.setKiloOrgCodeIndexProps({
				kilocodeToken: apiConfiguration.kilocodeToken,
				organizationId: apiConfiguration.kilocodeOrganizationId,
				projectId,
			})

			return true
		}

		provider.log(
			`[startIndexing] No Kilo org props available: token=${!!apiConfiguration.kilocodeToken}, orgId=${!!apiConfiguration.kilocodeOrganizationId}`,
		)
	} catch (error) {
		provider.log(`Error starting indexing: ${error instanceof Error ? error.message : String(error)}`)
		provider.log(`Stack: ${error instanceof Error ? error.stack : "N/A"}`)
	}

	return false
}

/**
 * Updates the code index manager with current Kilo org credentials
 * This should be called whenever the API configuration changes
 */
export async function updateCodeIndexWithKiloProps(provider: ClineProvider): Promise<void> {
	console.log("updateCodeIndexWithKiloProps", provider)

	try {
		const { apiConfiguration } = await provider.getState()

		// Only proceed if we have both required credentials
		if (!apiConfiguration.kilocodeToken || !apiConfiguration.kilocodeOrganizationId) {
			return
		}

		// Get kilocodeTesterWarningsDisabledUntil from context
		const kilocodeTesterWarningsDisabledUntil = provider.contextProxy.getValue(
			"kilocodeTesterWarningsDisabledUntil",
		)

		// Fetch organization settings to check if code indexing is enabled
		const organization = await OrganizationService.fetchOrganization(
			apiConfiguration.kilocodeToken,
			apiConfiguration.kilocodeOrganizationId,
			kilocodeTesterWarningsDisabledUntil,
		)

		// Check if code indexing is enabled for this organization
		const codeIndexingEnabled = OrganizationService.isCodeIndexingEnabled(organization)

		if (!codeIndexingEnabled) {
			provider.log("[updateCodeIndexWithKiloProps] Code indexing is disabled for provider organization")
			return
		}

		// Get project ID from Kilo config
		const kiloConfig = await provider.getKiloConfig()
		const projectId = kiloConfig?.project?.id

		if (!projectId) {
			provider.log("[updateCodeIndexWithKiloProps] No projectId found in Kilo config, skipping code index update")
			return
		}

		// Get or create the code index manager for the current workspace
		let codeIndexManager = provider.getCurrentWorkspaceCodeIndexManager()

		// If manager doesn't exist yet, it will be created on first access
		// We need to ensure it's initialized with the context proxy
		if (!codeIndexManager) {
			// Try to get the manager again, which will create it if workspace exists
			const workspacePath = provider.cwd
			if (workspacePath) {
				codeIndexManager = CodeIndexManager.getInstance(provider.context, workspacePath)
			}
		}

		if (codeIndexManager) {
			// Set the Kilo org props - code indexing is enabled
			codeIndexManager.setKiloOrgCodeIndexProps({
				kilocodeToken: apiConfiguration.kilocodeToken,
				organizationId: apiConfiguration.kilocodeOrganizationId,
				projectId,
			})

			// Initialize the manager with context proxy if not already initialized
			if (!codeIndexManager.isInitialized) {
				await codeIndexManager.initialize(provider.contextProxy)
			}
		}
	} catch (error) {
		provider.log(`Failed to update code index with Kilo props: ${error}`)
	}
}
