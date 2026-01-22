import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { KilocodeProfileData } from "../../auth/types.js"
import type { CLIConfig, ProviderConfig } from "../../config/types.js"
import { getKilocodeProfile, INVALID_TOKEN_ERROR } from "../../auth/providers/kilocode/shared.js"
import { buildProfileOutput, classifyProfileFetchError, profileApiCommand } from "../profile-api.js"
import { loadConfigAtom } from "../../state/atoms/config.js"

const storeSetMock = vi.hoisted(() => vi.fn())

vi.mock("jotai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("jotai")>()
	return {
		...actual,
		createStore: () => ({
			set: storeSetMock,
		}),
	}
})

vi.mock("../../auth/providers/kilocode/shared.js", async () => {
	const actual = await vi.importActual<typeof import("../../auth/providers/kilocode/shared.js")>(
		"../../auth/providers/kilocode/shared.js",
	)
	return {
		...actual,
		getKilocodeProfile: vi.fn(),
	}
})

describe("profile-api command", () => {
	it("should classify invalid token errors", () => {
		const error = new Error(INVALID_TOKEN_ERROR)
		const result = classifyProfileFetchError(error)
		expect(result.code).toBe("NOT_AUTHENTICATED")
	})

	it("should classify network errors by message", () => {
		const error = new Error("Failed to fetch profile: fetch failed")
		const result = classifyProfileFetchError(error)
		expect(result.code).toBe("NETWORK_ERROR")
	})

	it("should classify network errors by error code (ETIMEDOUT)", () => {
		const error = Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" })
		const result = classifyProfileFetchError(error)
		expect(result.code).toBe("NETWORK_ERROR")
	})

	it("should classify network errors by error code (ECONNREFUSED)", () => {
		const error = Object.assign(new Error("Connection refused"), { code: "ECONNREFUSED" })
		const result = classifyProfileFetchError(error)
		expect(result.code).toBe("NETWORK_ERROR")
	})

	it("should classify abort errors as network errors", () => {
		const error = new Error("Failed to fetch profile: The operation was aborted")
		const result = classifyProfileFetchError(error)
		expect(result.code).toBe("NETWORK_ERROR")
	})

	it("should classify API errors with status", () => {
		const error = new Error("Failed to fetch profile: 500")
		const result = classifyProfileFetchError(error)
		expect(result.code).toBe("API_ERROR")
	})

	it("should build profile output with user and organization", () => {
		const profile: KilocodeProfileData = {
			user: {
				name: "Jane Doe",
				email: undefined,
			},
			organizations: [
				{
					id: "org_123",
					name: "Example Org",
					role: "admin",
				},
			],
		}

		const provider = {
			id: "kilocode-1",
			provider: "kilocode",
			kilocodeOrganizationId: "org_123",
		} as ProviderConfig

		const output = buildProfileOutput(profile, provider)
		expect(output.authenticated).toBe(true)
		expect(output.provider).toBe("kilocode")
		expect(output.user?.name).toBe("Jane Doe")
		expect(output.user?.email).toBeNull()
		expect(output.organization?.id).toBe("org_123")
	})
})

describe("profileApiCommand", () => {
	let configForTest: CLIConfig | Error
	let consoleLogSpy: ReturnType<typeof vi.spyOn>
	let processExitSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit called")
		})
		storeSetMock.mockImplementation(async () => {
			if (configForTest instanceof Error) {
				throw configForTest
			}
			return configForTest
		})
	})

	afterEach(() => {
		consoleLogSpy.mockRestore()
		processExitSpy.mockRestore()
		storeSetMock.mockReset()
		vi.clearAllMocks()
	})

	it("should output profile JSON for authenticated Kilocode provider", async () => {
		configForTest = {
			provider: "kilocode-1",
			providers: [
				{
					id: "kilocode-1",
					provider: "kilocode",
					kilocodeToken: "test-token",
					kilocodeOrganizationId: "org_123",
				},
			],
		} as CLIConfig

		vi.mocked(getKilocodeProfile).mockResolvedValue({
			user: { name: "Jane Doe", email: "jane@example.com" },
			organizations: [{ id: "org_123", name: "Example Org", role: "admin" }],
		})

		await expect(profileApiCommand()).rejects.toThrow("process.exit called")

		expect(storeSetMock).toHaveBeenCalledWith(loadConfigAtom)
		expect(processExitSpy).toHaveBeenCalledWith(0)
		const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as {
			authenticated: boolean
			provider: string
			user?: { name: string | null; email: string | null }
			organization?: { id: string; name: string; role: string }
		}
		expect(output.authenticated).toBe(true)
		expect(output.provider).toBe("kilocode")
		expect(output.user?.name).toBe("Jane Doe")
		expect(output.organization?.id).toBe("org_123")
	})

	it("should return PROVIDER_NOT_FOUND when provider ID is missing", async () => {
		configForTest = {
			provider: "missing-provider",
			providers: [],
		} as CLIConfig

		await expect(profileApiCommand()).rejects.toThrow("process.exit called")

		expect(processExitSpy).toHaveBeenCalledWith(1)
		const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as { code: string }
		expect(output.code).toBe("PROVIDER_NOT_FOUND")
		expect(getKilocodeProfile).not.toHaveBeenCalled()
	})

	it("should return NOT_KILOCODE_PROVIDER when provider is not Kilocode", async () => {
		configForTest = {
			provider: "openai-1",
			providers: [
				{
					id: "openai-1",
					provider: "openai",
					apiKey: "test-key",
				},
			],
		} as CLIConfig

		await expect(profileApiCommand()).rejects.toThrow("process.exit called")

		expect(processExitSpy).toHaveBeenCalledWith(1)
		const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as { code: string }
		expect(output.code).toBe("NOT_KILOCODE_PROVIDER")
	})

	it("should return NOT_AUTHENTICATED when token is missing", async () => {
		configForTest = {
			provider: "kilocode-1",
			providers: [
				{
					id: "kilocode-1",
					provider: "kilocode",
				},
			],
		} as CLIConfig

		await expect(profileApiCommand()).rejects.toThrow("process.exit called")

		expect(processExitSpy).toHaveBeenCalledWith(1)
		const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as { code: string }
		expect(output.code).toBe("NOT_AUTHENTICATED")
	})

	it("should return NETWORK_ERROR when profile fetch fails with network error code", async () => {
		configForTest = {
			provider: "kilocode-1",
			providers: [
				{
					id: "kilocode-1",
					provider: "kilocode",
					kilocodeToken: "test-token",
				},
			],
		} as CLIConfig

		const networkError = Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" })
		vi.mocked(getKilocodeProfile).mockRejectedValue(networkError)

		await expect(profileApiCommand()).rejects.toThrow("process.exit called")

		expect(processExitSpy).toHaveBeenCalledWith(1)
		const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string) as { code: string }
		expect(output.code).toBe("NETWORK_ERROR")
	})
})
