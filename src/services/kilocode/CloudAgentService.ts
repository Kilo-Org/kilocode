import {
	type CloudAgentPrepareRequest,
	type CloudAgentPrepareResponse,
	type CloudAgentInitiateResponse,
	type CloudAgentSendMessageResponse,
	type AgentMode,
	getCloudAgentPrepareUrl,
	getCloudAgentInitiateUrl,
	getCloudAgentSendMessageUrl,
	getCloudAgentStreamUrl,
	CloudAgentPrepareResponseSchema,
	CloudAgentInitiateResponseSchema,
	CloudAgentSendMessageResponseSchema,
} from "@roo-code/types"

/**
 * Parameters for preparing a cloud agent session
 */
export interface PrepareSessionParams {
	/** GitHub repository in "owner/repo" format (e.g., "kilocode/kilocode") */
	githubRepo: string
	/** The initial prompt/task for the agent */
	prompt: string
	/** Kilo Code execution mode */
	mode: AgentMode
	/** AI model to use (e.g., "claude-sonnet-4-20250514") */
	model: string
	/** Kilo Code authentication token */
	kilocodeToken: string
	/** Organization ID (optional) */
	organizationId?: string
}

/**
 * Service for interacting with the Kilo Code Cloud Agent V2 API.
 *
 * The Cloud Agent API allows running agent sessions in the cloud instead of locally.
 * This is useful when users don't have the CLI installed or prefer cloud execution.
 *
 * Flow:
 * 1. prepareSession() - Creates a session and returns a cloudAgentSessionId
 * 2. initiateSession() - Starts the agent execution
 * 3. Connect to WebSocket stream for real-time updates
 * 4. sendMessage() - Send follow-up messages (queued, run sequentially)
 */
export class CloudAgentService {
	/**
	 * Prepare a new cloud agent session.
	 *
	 * @param params - Session parameters including gitUrl, prompt, and token
	 * @returns The prepared session response with cloudAgentSessionId
	 * @throws Error if token is missing or API call fails
	 */
	async prepareSession(params: PrepareSessionParams): Promise<CloudAgentPrepareResponse> {
		if (!params.kilocodeToken) {
			throw new Error("kilocodeToken is required")
		}

		const requestBody: CloudAgentPrepareRequest = {
			githubRepo: params.githubRepo,
			prompt: params.prompt,
			mode: params.mode,
			model: params.model,
			organizationId: params.organizationId,
		}

		const response = await fetch(getCloudAgentPrepareUrl(), {
			method: "POST",
			headers: {
				Authorization: `Bearer ${params.kilocodeToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestBody),
		})

		if (!response.ok) {
			// Try to extract error details from response body
			let errorMessage = `Failed to prepare cloud agent session: ${response.status}`
			try {
				const errorData = await response.json()
				if (errorData.error) {
					errorMessage = errorData.error
				}
				if (errorData.details && Array.isArray(errorData.details)) {
					const detailMessages = errorData.details.map((d: { message?: string }) => d.message).filter(Boolean)
					if (detailMessages.length > 0) {
						errorMessage += `: ${detailMessages.join(", ")}`
					}
				}
			} catch (parseError) {
				console.warn("[CloudAgentService] Failed to parse error response:", parseError)
			}
			throw new Error(errorMessage)
		}

		const data = await response.json()
		const validated = CloudAgentPrepareResponseSchema.safeParse(data)

		if (!validated.success) {
			console.warn("[CloudAgentService] Invalid prepare response format", validated.error.errors)
			// Continue with unvalidated data for graceful degradation
			return data as CloudAgentPrepareResponse
		}

		return validated.data
	}

	/**
	 * Initiate a prepared cloud agent session.
	 *
	 * This starts the actual agent execution in the cloud.
	 *
	 * @param cloudAgentSessionId - The session ID from prepareSession()
	 * @returns The initiation response
	 * @throws Error if API call fails
	 */
	async initiateSession(cloudAgentSessionId: string): Promise<CloudAgentInitiateResponse> {
		const response = await fetch(getCloudAgentInitiateUrl(), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ cloudAgentSessionId }),
		})

		if (!response.ok) {
			throw new Error(`Failed to initiate cloud agent session: ${response.status}`)
		}

		const data = await response.json()
		const validated = CloudAgentInitiateResponseSchema.safeParse(data)

		if (!validated.success) {
			console.warn("[CloudAgentService] Invalid initiate response format", validated.error.errors)
			return data as CloudAgentInitiateResponse
		}

		return validated.data
	}

	/**
	 * Send a follow-up message to a running cloud agent session.
	 *
	 * Messages are queued and processed sequentially by the agent.
	 *
	 * @param cloudAgentSessionId - The session ID
	 * @param message - The message content
	 * @returns The send message response with queue position
	 * @throws Error if API call fails
	 */
	async sendMessage(cloudAgentSessionId: string, message: string): Promise<CloudAgentSendMessageResponse> {
		const response = await fetch(getCloudAgentSendMessageUrl(), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ cloudAgentSessionId, message }),
		})

		if (!response.ok) {
			throw new Error(`Failed to send message to cloud agent: ${response.status}`)
		}

		const data = await response.json()
		const validated = CloudAgentSendMessageResponseSchema.safeParse(data)

		if (!validated.success) {
			console.warn("[CloudAgentService] Invalid send message response format", validated.error.errors)
			return data as CloudAgentSendMessageResponse
		}

		return validated.data
	}

	/**
	 * Get the WebSocket URL for streaming cloud agent events.
	 *
	 * @param cloudAgentSessionId - The session ID
	 * @returns The WebSocket URL
	 */
	getStreamUrl(cloudAgentSessionId: string): string {
		return getCloudAgentStreamUrl(cloudAgentSessionId)
	}

	/**
	 * Check if a valid Kilo Code token is available.
	 *
	 * @param token - The token to check
	 * @returns True if the token is valid (non-empty string)
	 */
	hasValidToken(token: string | undefined): boolean {
		return typeof token === "string" && token.length > 0
	}
}
