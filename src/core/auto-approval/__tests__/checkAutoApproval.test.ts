import { checkAutoApproval } from "../index"
import { ExtensionState } from "@roo-code/types"

describe("checkAutoApproval", () => {
	const mockAsk = "tool"

	it("should approve deleteFile when alwaysAllowDelete is true", async () => {
		const state = {
			alwaysAllowDelete: true,
			autoApprovalEnabled: true,
		} as ExtensionState

		const text = JSON.stringify({
			tool: "deleteFile",
			path: "/path/to/file",
		})

		const result = await checkAutoApproval({ state, ask: mockAsk, text })
		expect(result).toEqual({ decision: "approve" })
	})

	it("should ask for deleteFile when alwaysAllowDelete is false", async () => {
		const state = {
			alwaysAllowDelete: false,
			autoApprovalEnabled: true,
		} as ExtensionState

		const text = JSON.stringify({
			tool: "deleteFile",
			path: "/path/to/file",
		})

		const result = await checkAutoApproval({ state, ask: mockAsk, text })
		expect(result).toEqual({ decision: "ask" })
	})

	it("should ask for deleteFile when alwaysAllowDelete is undefined", async () => {
		const state = {
			autoApprovalEnabled: true,
		} as ExtensionState

		const text = JSON.stringify({
			tool: "deleteFile",
			path: "/path/to/file",
		})

		const result = await checkAutoApproval({ state, ask: mockAsk, text })
		expect(result).toEqual({ decision: "ask" })
	})

	it("should ask when autoApprovalEnabled is false even if alwaysAllowDelete is true", async () => {
		const state = {
			alwaysAllowDelete: true,
			autoApprovalEnabled: false,
		} as ExtensionState

		const text = JSON.stringify({
			tool: "deleteFile",
			path: "/path/to/file",
		})

		const result = await checkAutoApproval({ state, ask: mockAsk, text })
		expect(result).toEqual({ decision: "ask" })
	})
})
