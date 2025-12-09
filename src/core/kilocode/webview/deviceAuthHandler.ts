import * as vscode from "vscode"
import { DeviceAuthService } from "../../../services/kilocode/DeviceAuthService"
import type { ExtensionMessage } from "../../../shared/ExtensionMessage"

/**
 * Callbacks required by DeviceAuthHandler to communicate with the provider
 */
export interface DeviceAuthHandlerCallbacks {
	postMessageToWebview: (message: ExtensionMessage) => Promise<void>
	log: (message: string) => void
	showInformationMessage: (message: string) => void
}

/**
 * Handles device authorization flow for Kilo Code authentication
 * This class encapsulates all device auth logic to keep ClineProvider clean
 */
export class DeviceAuthHandler {
	private deviceAuthService?: DeviceAuthService
	private callbacks: DeviceAuthHandlerCallbacks

	constructor(callbacks: DeviceAuthHandlerCallbacks) {
		this.callbacks = callbacks
	}

	/**
	 * Start the device authorization flow
	 */
	async startDeviceAuth(): Promise<void> {
		try {
			// Clean up any existing device auth service
			if (this.deviceAuthService) {
				this.deviceAuthService.dispose()
			}

			this.deviceAuthService = new DeviceAuthService()

			// Set up event listeners
			this.deviceAuthService.on("started", (data: any) => {
				this.callbacks.postMessageToWebview({
					type: "deviceAuthStarted",
					deviceAuthCode: data.code,
					deviceAuthVerificationUrl: data.verificationUrl,
					deviceAuthExpiresIn: data.expiresIn,
				})
				// Open browser automatically
				vscode.env.openExternal(vscode.Uri.parse(data.verificationUrl))
			})

			this.deviceAuthService.on("polling", (timeRemaining: any) => {
				this.callbacks.postMessageToWebview({
					type: "deviceAuthPolling",
					deviceAuthTimeRemaining: timeRemaining,
				})
			})

			this.deviceAuthService.on("success", async (token: any, userEmail: any) => {
				this.callbacks.postMessageToWebview({
					type: "deviceAuthComplete",
					deviceAuthToken: token,
					deviceAuthUserEmail: userEmail,
				})

				this.callbacks.showInformationMessage(
					`Kilo Code successfully configured! Authenticated as ${userEmail}`,
				)

				// Clean up
				this.deviceAuthService?.dispose()
				this.deviceAuthService = undefined
			})

			this.deviceAuthService.on("denied", () => {
				this.callbacks.postMessageToWebview({
					type: "deviceAuthFailed",
					deviceAuthError: "Authorization was denied",
				})

				this.deviceAuthService?.dispose()
				this.deviceAuthService = undefined
			})

			this.deviceAuthService.on("expired", () => {
				this.callbacks.postMessageToWebview({
					type: "deviceAuthFailed",
					deviceAuthError: "Authorization code expired. Please try again.",
				})

				this.deviceAuthService?.dispose()
				this.deviceAuthService = undefined
			})

			this.deviceAuthService.on("error", (error: any) => {
				this.callbacks.postMessageToWebview({
					type: "deviceAuthFailed",
					deviceAuthError: error.message,
				})

				this.deviceAuthService?.dispose()
				this.deviceAuthService = undefined
			})

			this.deviceAuthService.on("cancelled", () => {
				this.callbacks.postMessageToWebview({
					type: "deviceAuthCancelled",
				})
			})

			// Start the auth flow
			await this.deviceAuthService.initiate()
		} catch (error) {
			this.callbacks.log(`Error starting device auth: ${error instanceof Error ? error.message : String(error)}`)

			this.callbacks.postMessageToWebview({
				type: "deviceAuthFailed",
				deviceAuthError: error instanceof Error ? error.message : "Failed to start authentication",
			})

			this.deviceAuthService?.dispose()
			this.deviceAuthService = undefined
		}
	}

	/**
	 * Cancel the device authorization flow
	 */
	cancelDeviceAuth(): void {
		if (this.deviceAuthService) {
			this.deviceAuthService.cancel()
			// Clean up the service after cancellation
			// Use setTimeout to avoid disposing during event emission
			setTimeout(() => {
				if (this.deviceAuthService) {
					this.deviceAuthService.dispose()
					this.deviceAuthService = undefined
				}
			}, 0)
		}
	}

	/**
	 * Clean up resources
	 */
	dispose(): void {
		if (this.deviceAuthService) {
			this.deviceAuthService.dispose()
			this.deviceAuthService = undefined
		}
	}
}
