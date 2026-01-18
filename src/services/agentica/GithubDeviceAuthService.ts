import EventEmitter from "events"
import axios from "axios"

const POLL_INTERVAL_MS = 5000 // GitHub recommends polling every 5 seconds
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code"
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"

export interface GithubDeviceAuthResponse {
	device_code: string
	user_code: string
	verification_uri: string
	expires_in: number
	interval: number
}

export interface GithubTokenResponse {
	access_token: string
	token_type: string
	scope?: string
}

export interface DeviceAuthServiceEvents {
	started: [data: { userCode: string; verificationUrl: string; expiresIn: number }]
	polling: [timeRemaining: number]
	success: [accessToken: string]
	denied: []
	expired: []
	error: [error: Error]
	cancelled: []
}

/**
 * Service for handling GitHub device authorization flow for Agentica
 */
export class GithubDeviceAuthService extends EventEmitter<DeviceAuthServiceEvents> {
	private pollIntervalId?: NodeJS.Timeout
	private startTime?: number
	private expiresIn?: number
	private deviceCode?: string
	private pollInterval?: number
	private aborted = false
	private clientId: string

	// Agentica GitHub OAuth Client ID
	private static readonly DEFAULT_CLIENT_ID = "Ov23lioKGgXQS2BOFDWO"

	constructor(clientId?: string) {
		super()
		this.clientId = clientId || GithubDeviceAuthService.DEFAULT_CLIENT_ID
	}

	/**
	 * Initiate GitHub device authorization flow
	 * @returns Device authorization details
	 * @throws Error if initiation fails
	 */
	async initiate(): Promise<{ userCode: string; verificationUrl: string; expiresIn: number }> {
		try {
			const response = await axios.post<GithubDeviceAuthResponse>(
				GITHUB_DEVICE_CODE_URL,
				new URLSearchParams({
					client_id: this.clientId,
					scope: "user:email",
				}),
				{
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						Accept: "application/json",
					},
				},
			)

			const data = response.data
			this.deviceCode = data.device_code
			this.expiresIn = data.expires_in
			this.pollInterval = data.interval * 1000 // Convert to milliseconds
			this.startTime = Date.now()
			this.aborted = false

			const authData = {
				userCode: data.user_code,
				verificationUrl: data.verification_uri,
				expiresIn: data.expires_in,
			}

			this.emit("started", authData)

			// Start polling
			this.startPolling()

			return authData
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error))
			this.emit("error", err)
			throw err
		}
	}

	/**
	 * Poll for device authorization status
	 */
	private async poll(): Promise<void> {
		if (!this.deviceCode || this.aborted) {
			return
		}

		// Don't check expiration here - let GitHub tell us via expired_token error
		// This ensures we continue polling even if timer reaches 0

		try {
			const response = await axios.post<GithubTokenResponse>(
				GITHUB_TOKEN_URL,
				new URLSearchParams({
					client_id: this.clientId,
					device_code: this.deviceCode,
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				}),
				{
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						Accept: "application/json",
					},
				},
			)

			if (response.data && response.data.access_token) {
				// Success - user has authorized
				console.log("[GithubDeviceAuthService] Successfully received access token from GitHub")
				this.stopPolling()
				this.emit("success", response.data.access_token)
				return
			} else {
				console.warn("[GithubDeviceAuthService] Unexpected response structure:", response.data)
			}
		} catch (error: any) {
			// Check if aborted before processing error
			if (this.aborted) {
				return
			}

			if (error.response) {
				const errorType = error.response.data?.error

				if (errorType === "authorization_pending") {
					// Still pending - emit time remaining and continue polling
					// Always emit time remaining, even if it's 0 or negative
					// Continue polling until GitHub explicitly returns expired_token
					if (this.startTime && this.expiresIn) {
						const elapsed = Date.now() - this.startTime
						const timeRemaining = this.expiresIn * 1000 - elapsed
						// Emit actual time remaining (can be negative) - frontend will handle display
						this.emit("polling", Math.max(0, timeRemaining))
					}
					// Continue polling - don't stop until GitHub returns expired_token
					return
				}

				if (errorType === "slow_down") {
					// GitHub is asking us to slow down - increase poll interval
					if (this.pollInterval) {
						const newInterval = Math.min(this.pollInterval * 1.5, 60000) // Max 60 seconds
						// Update interval and restart with new timing
						this.stopPolling()
						this.pollInterval = newInterval
						// Restart polling with new interval (will be called from the interval callback)
						const interval = this.pollInterval
						this.pollIntervalId = setInterval(() => {
							if (this.aborted || !this.deviceCode) {
								this.stopPolling()
								return
							}
							this.poll().catch((err) => {
								if (!this.aborted) {
									const error = err instanceof Error ? err : new Error(String(err))
									this.emit("error", error)
								}
							})
						}, interval)
					}
					return
				}

				if (errorType === "expired_token") {
					this.stopPolling()
					this.emit("expired")
					return
				}

				if (errorType === "access_denied") {
					this.stopPolling()
					this.emit("denied")
					return
				}
			}

			// Only emit error for unexpected errors, not for expected ones like authorization_pending
			if (!error.response || error.response.status >= 500) {
				const err = error instanceof Error ? error : new Error(String(error))
				this.emit("error", err)
			}
		}
	}

	/**
	 * Start polling for authorization
	 */
	private startPolling(): void {
		if (this.pollIntervalId) {
			clearInterval(this.pollIntervalId)
		}

		// Poll immediately (don't await to avoid blocking)
		this.poll().catch((err) => {
			// Only emit error if not aborted and it's a real error
			if (!this.aborted) {
				const error = err instanceof Error ? err : new Error(String(err))
				this.emit("error", error)
			}
		})

		// Then poll at the specified interval
		const interval = this.pollInterval || POLL_INTERVAL_MS
		this.pollIntervalId = setInterval(() => {
			if (this.aborted || !this.deviceCode) {
				this.stopPolling()
				return
			}
			
			// Don't check expiration here - let GitHub's API tell us via expired_token error
			// This ensures we continue polling even if timer reaches 0
			// The poll() method will handle expired_token response from GitHub
			
			this.poll().catch((err) => {
				// Only emit error if not aborted and it's a real error
				if (!this.aborted) {
					const error = err instanceof Error ? err : new Error(String(err))
					this.emit("error", error)
				}
			})
		}, interval)
	}

	/**
	 * Stop polling
	 */
	private stopPolling(): void {
		if (this.pollIntervalId) {
			clearInterval(this.pollIntervalId)
			this.pollIntervalId = undefined
		}
	}

	/**
	 * Cancel the device auth flow
	 */
	cancel(): void {
		this.aborted = true
		this.stopPolling()
		this.emit("cancelled")
	}

	/**
	 * Dispose of the service
	 */
	dispose(): void {
		this.cancel()
		this.removeAllListeners()
	}
}

