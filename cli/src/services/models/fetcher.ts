import { logs } from "../../services/logs.js"
import { createExtensionService, type ExtensionService } from "../../services/extension.js"
import { mapProviderToApiConfig } from "../../config/mapper.js"
import type { ProviderConfig } from "../../config/types.js"
import type { RouterModels, ExtensionMessage } from "../../types/messages.js"

/** Default timeout for router models request (30 seconds) */
const ROUTER_MODELS_TIMEOUT_MS = 30000

/**
 * Fetch router models from the extension
 *
 * This function:
 * 1. Creates an ExtensionService
 * 2. Initializes it (loads and activates the extension)
 * 3. Injects provider configuration
 * 4. Sends requestRouterModels message
 * 5. Waits for routerModels response with timeout
 * 6. Disposes the service
 *
 * @param provider - The provider configuration
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns RouterModels or null if fetch failed
 */
export async function fetchRouterModels(
	provider: ProviderConfig,
	timeoutMs: number = ROUTER_MODELS_TIMEOUT_MS,
): Promise<RouterModels | null> {
	let service: ExtensionService | null = null

	try {
		logs.info("Initializing extension to fetch router models", "ModelFetcher")

		// Create extension service
		service = createExtensionService({
			workspace: process.cwd(),
		})

		// Initialize the service (loads and activates extension)
		await service.initialize()
		logs.debug("Extension service initialized", "ModelFetcher")

		// Wait for the service to be ready
		if (!service.isReady()) {
			// Wait for the 'ready' event with timeout
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("Extension service ready timeout"))
				}, 10000)

				service!.once("ready", () => {
					clearTimeout(timeout)
					resolve()
				})
			})
		}

		// Inject provider configuration
		const apiConfiguration = mapProviderToApiConfig(provider)
		const extensionHost = service.getExtensionHost()
		await extensionHost.injectConfiguration({
			apiConfiguration,
			currentApiConfigName: provider.id,
		})
		logs.debug("Provider configuration injected", "ModelFetcher")

		// Create a promise that resolves when we receive routerModels
		const routerModelsPromise = new Promise<RouterModels | null>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error(`Router models request timed out after ${timeoutMs}ms`))
			}, timeoutMs)

			const messageHandler = (message: ExtensionMessage) => {
				if (message.type === "routerModels" && message.routerModels) {
					clearTimeout(timeout)
					service!.off("message", messageHandler)
					resolve(message.routerModels as RouterModels)
				}
			}

			service!.on("message", messageHandler)
		})

		// Send requestRouterModels message
		await service.sendWebviewMessage({
			type: "requestRouterModels",
		})
		logs.debug("Sent requestRouterModels message", "ModelFetcher")

		// Wait for response
		const routerModels = await routerModelsPromise
		logs.info("Received router models", "ModelFetcher", {
			providerCount: routerModels ? Object.keys(routerModels).length : 0,
		})

		return routerModels
	} catch (error) {
		logs.error("Failed to fetch router models", "ModelFetcher", { error })
		return null
	} finally {
		// Always dispose the service
		if (service) {
			try {
				await service.dispose()
				logs.debug("Extension service disposed", "ModelFetcher")
			} catch (disposeError) {
				logs.warn("Error disposing extension service", "ModelFetcher", { error: disposeError })
			}
		}
	}
}
