import { Terminal } from "../Terminal"
import { getWorkspacePath } from "../../../utils/path"
import { MockedFunction } from "vitest"

vi.mock("../../../utils/path", () => ({ getWorkspacePath: vi.fn() }))

describe("Terminal Environment Variables", () => {
	const mockWorkspacePath = "/Users/test/workspace"
	const mockGetWorkspacePath = getWorkspacePath as MockedFunction<typeof getWorkspacePath>

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should include WORKSPACE_ROOT environment variable", () => {
		mockGetWorkspacePath.mockReturnValue(mockWorkspacePath)

		const env = Terminal.getEnv()
		expect(env.WORKSPACE_ROOT).toBe(mockWorkspacePath)
		expect(mockGetWorkspacePath).toHaveBeenCalledTimes(1)
	})

	it("should handle empty workspace path", () => {
		mockGetWorkspacePath.mockReturnValue("")

		const env = Terminal.getEnv()
		expect(env.WORKSPACE_ROOT).toBe("")
		expect(mockGetWorkspacePath).toHaveBeenCalledTimes(1)
	})

	it("should include other required environment variables", () => {
		mockGetWorkspacePath.mockReturnValue(mockWorkspacePath)

		const env = Terminal.getEnv()
		expect(env.PAGER).toBeDefined()
		expect(env.VTE_VERSION).toBe("0")
		expect(env.WORKSPACE_ROOT).toBe(mockWorkspacePath)
	})
})
