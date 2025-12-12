import type { SessionClient } from "./SessionClient.js"
import type { SessionStateManager } from "./SessionStateManager.js"
import type { ILogger } from "../types/ILogger.js"
import { LOG_SOURCES } from "../config.js"

/**
 * Dependencies required by TokenValidationService.
 */
export interface TokenValidationServiceDependencies {
	sessionClient: SessionClient
	stateManager: SessionStateManager
	getToken: () => Promise<string>
	logger: ILogger
}

/**
 * TokenValidationService - Handles authentication token validation with caching.
 *
 * This service is responsible for:
 * - Validating authentication tokens against the server
 * - Caching validation results to avoid redundant API calls
 * - Invalidating the cache when errors occur
 *
 * Extracted from SessionManager as part of the refactoring effort to improve
 * maintainability and testability through separation of concerns.
 */
export class TokenValidationService {
	private readonly sessionClient: SessionClient
	private readonly stateManager: SessionStateManager
	private readonly getToken: () => Promise<string>
	private readonly logger: ILogger

	constructor(dependencies: TokenValidationServiceDependencies) {
		this.sessionClient = dependencies.sessionClient
		this.stateManager = dependencies.stateManager
		this.getToken = dependencies.getToken
		this.logger = dependencies.logger
	}

	/**
	 * Checks if the current token is valid.
	 *
	 * This method:
	 * 1. Retrieves the current token
	 * 2. Checks if validity is already cached
	 * 3. If not cached, validates against the server and caches the result
	 *
	 * @returns Promise<boolean> - true if token is valid, false otherwise
	 * @returns Promise<null> - if no token is available
	 */
	async isValid(): Promise<boolean | null> {
		const token = await this.getToken()

		if (!token) {
			this.logger.debug("No token available for validation", LOG_SOURCES.TOKEN_VALIDATION)
			return null
		}

		const cachedValidity = this.stateManager.getTokenValidity(token)

		if (cachedValidity !== undefined) {
			this.logger.debug("Using cached token validity", LOG_SOURCES.TOKEN_VALIDATION, {
				tokenValid: cachedValidity,
			})
			return cachedValidity
		}

		this.logger.debug("Checking token validity", LOG_SOURCES.TOKEN_VALIDATION)

		try {
			const tokenValid = await this.sessionClient.tokenValid()

			this.stateManager.setTokenValidity(token, tokenValid)

			this.logger.debug("Token validity checked", LOG_SOURCES.TOKEN_VALIDATION, {
				tokenValid,
			})

			return tokenValid
		} catch (error) {
			this.logger.error("Failed to check token validity", LOG_SOURCES.TOKEN_VALIDATION, {
				error: error instanceof Error ? error.message : String(error),
			})
			return false
		}
	}

	/**
	 * Invalidates the cached validity for the current token.
	 *
	 * This should be called when an operation fails due to authentication issues,
	 * forcing a re-validation on the next check.
	 */
	async invalidateCache(): Promise<void> {
		const token = await this.getToken()

		if (token) {
			this.stateManager.clearTokenValidity(token)
			this.logger.debug("Token validity cache invalidated", LOG_SOURCES.TOKEN_VALIDATION)
		}
	}
}
