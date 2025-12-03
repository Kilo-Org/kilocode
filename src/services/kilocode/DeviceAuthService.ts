import EventEmitter from "events"
import { getApiUrl } from "@roo-code/types"
import type { DeviceAuthInitiateResponse, DeviceAuthPollResponse } from "@roo-code/types"

const POLL_INTERVAL_MS = 3000

export interface DeviceAuthServiceEvents {
	started: [data: DeviceAuthInitiateResponse]
	polling: [timeRemaining: number]
	success: [token: string, userEmail: string]
	denied: []
	expired: []
	error: [error: Error]
	cancelled: []
}

/**
 * Service for handling device authorization flow
 */
export class DeviceAuthService extends EventEmitter<DeviceAuthServiceEvents> {
	private pollIntervalId?: NodeJS.Timeout
	private startTime?: number
	private expiresIn?: number
	private code?: string
	private aborted = false

	/**
	 * Initiate device authorization flow
	 * @returns Device authorization details
	 * @throws Error if initiation fails
	 */
	async initiate(): Promise<DeviceAuthInitiateResponse> {
		try {
			const response = await fetch(getApiUrl("/api/device-auth/codes"), {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
			})

			if (!response.ok) {
				if (response.status === 429) {
					throw new Error("Too many pending authorization requests. Please try again later.")
				}
				throw new Error(`Failed to initiate device authorization: ${response.status}`)
			}

			const data = (await response.json()) as DeviceAuthInitiateResponse

			this.code = data.code
			this.expiresIn = data.expiresIn
			this.startTime = Date.now()
			this.aborted = false

			this.emit("started", data)

			// Start polling
			this.startPolling()

			return data
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
		if (!this.code || this.aborted) {
			return
		}

		try {
			const response = await fetch(getApiUrl(`/api/device-auth/codes/${this.code}`))

			// Guard against undefined response (can happen in tests or network errors)
			if (!response) {
				return
			}

			if (response.status === 202) {
				// Still pending - emit time remaining
				if (this.startTime && this.expiresIn) {
					const elapsed = Math.floor((Date.now() - this.startTime) / 1000)
					const remaining = Math.max(0, this.expiresIn - elapsed)
					this.emit("polling", remaining)
				}
				return
			}

			// Stop polling for any non-pending status
			this.stopPolling()

			if (response.status === 403) {
				// Denied by user
				this.emit("denied")
				return
			}

			if (response.status === 410) {
				// Code expired
				this.emit("expired")
				return
			}

			if (!response.ok) {
				throw new Error(`Failed to poll device authorization: ${response.status}`)
			}

			const data = (await response.json()) as DeviceAuthPollResponse

			if (data.status === "approved" && data.token && data.userEmail) {
				this.emit("success", data.token, data.userEmail)
			} else if (data.status === "denied") {
				this.emit("denied")
			} else if (data.status === "expired") {
				this.emit("expired")
			}
		} catch (error) {
			this.stopPolling()
			const err = error instanceof Error ? error : new Error(String(error))
			this.emit("error", err)
		}
	}

	/**
	 * Start polling for authorization status
	 */
	private startPolling(): void {
		this.stopPolling()
		this.pollIntervalId = setInterval(() => {
			this.poll()
		}, POLL_INTERVAL_MS)

		// Do first poll immediately
		this.poll()
	}

	/**
	 * Stop polling for authorization status
	 */
	private stopPolling(): void {
		if (this.pollIntervalId) {
			clearInterval(this.pollIntervalId)
			this.pollIntervalId = undefined
		}
	}

	/**
	 * Cancel the device authorization flow
	 */
	cancel(): void {
		this.aborted = true
		this.stopPolling()
		this.emit("cancelled")
	}

	/**
	 * Clean up resources
	 */
	dispose(): void {
		this.aborted = true
		this.stopPolling()
		this.removeAllListeners()
	}
}
