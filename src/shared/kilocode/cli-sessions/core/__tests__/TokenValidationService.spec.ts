import { vi, type Mock } from "vitest"
import { TokenValidationService } from "../TokenValidationService"
import type { SessionClient } from "../SessionClient"
import type { SessionStateManager } from "../SessionStateManager"
import type { ILogger } from "../../types/ILogger"

describe("TokenValidationService", () => {
	let service: TokenValidationService
	let mockSessionClient: { tokenValid: Mock<() => Promise<boolean>> }
	let mockStateManager: {
		getTokenValidity: Mock<(token: string) => boolean | undefined>
		setTokenValidity: Mock<(token: string, valid: boolean) => void>
		clearTokenValidity: Mock<(token: string) => void>
	}
	let mockLogger: {
		debug: Mock<(message: string, source: string, metadata?: Record<string, unknown>) => void>
		info: Mock<(message: string, source: string, metadata?: Record<string, unknown>) => void>
		warn: Mock<(message: string, source: string, metadata?: Record<string, unknown>) => void>
		error: Mock<(message: string, source: string, metadata?: Record<string, unknown>) => void>
	}
	let mockGetToken: Mock<() => Promise<string>>

	beforeEach(() => {
		vi.clearAllMocks()

		// Mock SessionClient
		mockSessionClient = {
			tokenValid: vi.fn(),
		}

		// Mock SessionStateManager
		mockStateManager = {
			getTokenValidity: vi.fn(),
			setTokenValidity: vi.fn(),
			clearTokenValidity: vi.fn(),
		}

		// Mock ILogger
		mockLogger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		}

		// Mock getToken function
		mockGetToken = vi.fn()

		service = new TokenValidationService({
			sessionClient: mockSessionClient as any,
			stateManager: mockStateManager as any,
			getToken: mockGetToken,
			logger: mockLogger as any,
		})
	})

	describe("Token Validation", () => {
		it("isValid returns null when no token available", async () => {
			mockGetToken.mockResolvedValue("")

			const result = await service.isValid()

			expect(result).toBe(null)
		})

		it("isValid returns cached validity when available", async () => {
			const token = "test-token"
			mockGetToken.mockResolvedValue(token)
			mockStateManager.getTokenValidity.mockReturnValue(true)

			const result = await service.isValid()

			expect(result).toBe(true)
			expect(mockSessionClient.tokenValid).not.toHaveBeenCalled()
			expect(mockStateManager.setTokenValidity).not.toHaveBeenCalled()
		})

		it("isValid calls sessionClient.tokenValid when not cached", async () => {
			const token = "test-token"
			mockGetToken.mockResolvedValue(token)
			mockStateManager.getTokenValidity.mockReturnValue(undefined)
			mockSessionClient.tokenValid.mockResolvedValue(true)

			const result = await service.isValid()

			expect(result).toBe(true)
			expect(mockSessionClient.tokenValid).toHaveBeenCalledTimes(1)
			expect(mockStateManager.setTokenValidity).toHaveBeenCalledWith(token, true)
		})

		it("isValid caches result after API call", async () => {
			const token = "test-token"
			mockGetToken.mockResolvedValue(token)
			mockStateManager.getTokenValidity.mockReturnValue(undefined)
			mockSessionClient.tokenValid.mockResolvedValue(false)

			const result = await service.isValid()

			expect(result).toBe(false)
			expect(mockStateManager.setTokenValidity).toHaveBeenCalledWith(token, false)
		})

		it("isValid returns false on API error", async () => {
			const token = "test-token"
			mockGetToken.mockResolvedValue(token)
			mockStateManager.getTokenValidity.mockReturnValue(undefined)
			mockSessionClient.tokenValid.mockRejectedValue(new Error("API error"))

			const result = await service.isValid()

			expect(result).toBe(false)
		})
	})

	describe("Cache Invalidation", () => {
		it("invalidateCache clears cached validity", async () => {
			const token = "test-token"
			mockGetToken.mockResolvedValue(token)

			await service.invalidateCache()

			expect(mockStateManager.clearTokenValidity).toHaveBeenCalledWith(token)
		})

		it("invalidateCache does nothing when no token", async () => {
			mockGetToken.mockResolvedValue("")

			await service.invalidateCache()

			expect(mockStateManager.clearTokenValidity).not.toHaveBeenCalled()
		})

		it("isValid re-validates after cache invalidation", async () => {
			const token = "test-token"
			mockGetToken.mockResolvedValue(token)

			// First call - should cache
			mockStateManager.getTokenValidity.mockReturnValue(undefined)
			mockSessionClient.tokenValid.mockResolvedValue(true)
			await service.isValid()
			expect(mockSessionClient.tokenValid).toHaveBeenCalledTimes(1)

			// Invalidate cache
			await service.invalidateCache()

			// Second call - should re-validate
			mockStateManager.getTokenValidity.mockReturnValue(undefined)
			mockSessionClient.tokenValid.mockResolvedValue(false)
			const result = await service.isValid()

			expect(result).toBe(false)
			expect(mockSessionClient.tokenValid).toHaveBeenCalledTimes(2)
		})
	})

	describe("Logging", () => {
		it("logs debug message when no token available", async () => {
			mockGetToken.mockResolvedValue("")

			await service.isValid()

			expect(mockLogger.debug).toHaveBeenCalledWith("No token available for validation", "TokenValidationService")
		})

		it("logs debug message when using cached validity", async () => {
			const token = "test-token"
			mockGetToken.mockResolvedValue(token)
			mockStateManager.getTokenValidity.mockReturnValue(true)

			await service.isValid()

			expect(mockLogger.debug).toHaveBeenCalledWith("Using cached token validity", "TokenValidationService", {
				tokenValid: true,
			})
		})

		it("logs debug message when checking validity", async () => {
			const token = "test-token"
			mockGetToken.mockResolvedValue(token)
			mockStateManager.getTokenValidity.mockReturnValue(undefined)
			mockSessionClient.tokenValid.mockResolvedValue(true)

			await service.isValid()

			expect(mockLogger.debug).toHaveBeenCalledWith("Checking token validity", "TokenValidationService")
		})

		it("logs error on validation failure", async () => {
			const token = "test-token"
			mockGetToken.mockResolvedValue(token)
			mockStateManager.getTokenValidity.mockReturnValue(undefined)
			const error = new Error("API error")
			mockSessionClient.tokenValid.mockRejectedValue(error)

			await service.isValid()

			expect(mockLogger.error).toHaveBeenCalledWith("Failed to check token validity", "TokenValidationService", {
				error: error.message,
			})
		})
	})
})
